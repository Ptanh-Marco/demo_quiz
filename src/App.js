// *** FIX 1: Import useCallback ***
import React, { useState, useEffect, useRef, useCallback } from "react";
import { db } from "../../config/firebaseConfig";
import { ref, onValue, set, remove, get, update } from "firebase/database";
import Confetti from "react-confetti";
import "./AdminPanel.scss";
import { FaUsers, FaTrophy } from "react-icons/fa";

const QUESTION_TIME_LIMIT = 10;

// --- UTILITY FUNCTIONS (Unchanged) ---
function getInitials(name) {
    if (!name) return "";
    const parts = name.trim().split(" ");
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function getAvatarColor(idx) {
    const colors = ["#1976d2", "#388e3c", "#7b1fa2", "#fbc02d", "#d32f2f", "#0097a7", "#c2185b", "#5d4037", "#0288d1", "#f57c00"];
    return colors[idx % colors.length];
}
function getAvatar(name, idx, size = 32) {
    return (
        <span className="avatar-circle" style={{ background: getAvatarColor(idx), width: `${size}px`, height: `${size}px`, lineHeight: `${size}px`, fontSize: `${size * 0.5}px` }}>
            {getInitials(name)}
        </span>
    );
}

// --- MAIN COMPONENT ---
export default function AdminPanel() {
    const [participants, setParticipants] = useState([]);
    const [questions, setQuestions] = useState([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [timer, setTimerState] = useState(QUESTION_TIME_LIMIT);
    const [started, setStarted] = useState(false);
    const [finished, setFinished] = useState(false);
    const [leaderboard, setLeaderboard] = useState([]);
    const timerIntervalRef = useRef(null);
    const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });

    useEffect(() => {
        const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        const participantsRef = ref(db, "participants");
        const questionsRef = ref(db, "questions");
        const quizStateRef = ref(db, "quizState");
        const scoresRef = ref(db, "scores");
        const unsubParticipants = onValue(participantsRef, (snap) => {
            const pObj = snap.val();
            setParticipants(pObj ? Object.entries(pObj).map(([id, v]) => ({ ...v, id })) : []);
        });
        const unsubQuestions = onValue(questionsRef, (snap) => {
            const qObj = snap.val();
            setQuestions(qObj ? Object.entries(qObj).map(([id, q]) => ({ ...q, id })) : []);
        });
        const unsubQuizState = onValue(quizStateRef, (snap) => {
            const state = snap.val();
            if (state) {
                setStarted(state.started || false);
                setCurrentQuestionIndex(state.currentQuestionIndex || 0);
                setFinished(state.finished || false);
            } else {
                setStarted(false); setFinished(false); setCurrentQuestionIndex(0);
            }
        });
        const unsubScores = onValue(scoresRef, (snap) => {
            const scores = snap.val() || {};
            const participantData = participants.length > 0 ? participants : [];
            let board = [];
            Object.keys(scores).forEach((pid) => {
                const total = scores[pid]?.perQuestion ? Object.values(scores[pid].perQuestion).reduce((a, b) => a + b, 0) : 0;
                board.push({ name: participantData.find((p) => p.id === pid)?.name || "Unknown", points: total, pid });
            });
            board.sort((a, b) => b.points - a.points);
            setLeaderboard(board);
        });
        return () => { unsubParticipants(); unsubQuestions(); unsubQuizState(); unsubScores(); };
    }, [participants]);

    useEffect(() => {
        if (started && !finished) {
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
            setTimerState(QUESTION_TIME_LIMIT);
            set(ref(db, "quizState/timer"), QUESTION_TIME_LIMIT);
            timerIntervalRef.current = setInterval(() => setTimerState((prev) => prev - 1), 1000);
            return () => clearInterval(timerIntervalRef.current);
        }
    }, [currentQuestionIndex, started, finished]);

    // *** FIX 2: Memoize functions with useCallback ***
    const goToNextQuestion = useCallback(() => {
        if (currentQuestionIndex + 1 < questions.length) {
            set(ref(db, "quizState/currentQuestionIndex"), currentQuestionIndex + 1);
        } else {
            set(ref(db, "quizState/finished"), true);
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        }
    }, [currentQuestionIndex, questions.length]);

    const calculateAndStorePointsForCurrentQuestion = useCallback(async () => {
        if (!questions[currentQuestionIndex]) return;
        const q = questions[currentQuestionIndex];
        const questionId = q.id;
        const allAnswersSnap = await get(ref(db, `quizState/answers`));
        const allAnswers = allAnswersSnap.val() || {};
        const partSnap = await get(ref(db, "participants"));
        const participantsObj = partSnap.val() || {};
        let correctParticipants = [];
        Object.keys(participantsObj).forEach((pid) => {
            const ansObj = allAnswers[pid]?.[questionId] || {};
            let isCorrect = false;
            if (q.type === "fill_text") {
                const correctArr = Array.isArray(q.correct) ? q.correct : [q.correct];
                isCorrect = correctArr.some((ans) => ans.trim().toLowerCase() === (ansObj.answer || "").trim().toLowerCase());
            } else {
                isCorrect = ansObj.answer === q.correct;
            }
            if (isCorrect) correctParticipants.push({ pid, timeToAnswer: ansObj.timeToAnswer ?? QUESTION_TIME_LIMIT });
        });
        correctParticipants.sort((a, b) => a.timeToAnswer - b.timeToAnswer);
        const N = correctParticipants.length;
        const S = (N * (N + 1)) / 2;
        const updates = {};
        correctParticipants.forEach((p, i) => {
            const earned = N > 0 ? Math.round((1000 * (N - i)) / S) : 0;
            updates[`scores/${p.pid}/perQuestion/${currentQuestionIndex}`] = earned;
        });
        Object.keys(participantsObj).forEach((pid) => {
            if (updates[`scores/${pid}/perQuestion/${currentQuestionIndex}`] === undefined) {
                updates[`scores/${pid}/perQuestion/${currentQuestionIndex}`] = 0;
            }
        });
        if (Object.keys(updates).length > 0) await update(ref(db), updates);
    }, [currentQuestionIndex, questions]);

    useEffect(() => {
        if (started && !finished) {
            set(ref(db, "quizState/timer"), timer);
        }
        if (timer <= 0 && started && !finished) {
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
            const handleEndOfQuestion = async () => {
                await calculateAndStorePointsForCurrentQuestion();
                goToNextQuestion();
            };
            handleEndOfQuestion();
        }
        // *** FIX 3: Add the memoized functions to the dependency array ***
    }, [timer, started, finished, calculateAndStorePointsForCurrentQuestion, goToNextQuestion]);

    const startQuiz = () => set(ref(db, "quizState"), { started: true, currentQuestionIndex: 0, timer: QUESTION_TIME_LIMIT, finished: false });

    const resetQuiz = () => {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        set(ref(db, "quizState"), { started: false, finished: false, currentQuestionIndex: 0, timer: QUESTION_TIME_LIMIT });
        remove(ref(db, "participants")); remove(ref(db, "scores")); remove(ref(db, "quizState/answers"));
    };

    const q = questions[currentQuestionIndex];

    // --- RENDER LOGIC (Unchanged) ---
    return (
        <div className="admin-panel-root">
            {finished && <Confetti width={windowSize.width} height={windowSize.height} recycle={false} numberOfPieces={500} gravity={0.15} />}
            <header className="admin-header">
                <h1><span role="img" aria-label="admin" style={{ marginRight: 8 }}>⚽</span> Admin Panel</h1>
                <div className="admin-header-btns">
                    {!started && <button className="admin-btn" onClick={startQuiz} disabled={started || questions.length === 0}>Start Quiz</button>}
                    <button className="admin-btn reset" onClick={resetQuiz}>Reset Quiz</button>
                </div>
            </header>

            {!started && (
                <section className="admin-card admin-waiting-section">
                    <h2><FaUsers style={{ marginRight: 6 }} /> Participants Waiting ({participants.length})</h2>
                    <table className="admin-table">
                        <thead><tr><th>Avatar</th><th>Name</th><th>Joined</th></tr></thead>
                        <tbody>{participants.map((p, idx) => (<tr key={p.id}><td>{getAvatar(p.name, idx)}</td><td>{p.name}</td><td>{new Date(p.joined).toLocaleTimeString()}</td></tr>))}</tbody>
                    </table>
                </section>
            )}

            {started && !finished && q && (
                <section className="admin-card admin-quiz-section">
                    <div className="quiz-progress"><strong>Question {currentQuestionIndex + 1} / {questions.length}</strong></div>
                    <div className="timer">{timer}s</div>
                    <div className="quiz-question-area">
                        {q.image && <img className="current-q-img" src={q.image} alt="Question visual" />}
                        <div className="quiz-q-text"><strong>{q.question}</strong></div>
                    </div>
                    <div className="admin-options-container">
                        {q.type === "single_choice" && q.options.map((opt) => (<div key={opt} className="admin-option-btn">{opt}</div>))}
                        {q.type === "fill_text" && (<div className="admin-fill-text-display"><input type="text" placeholder="Participants will type here..." disabled /></div>)}
                        {q.type === "image_choice" && q.options.map((opt) => (<div key={opt.label} className="admin-option-image-btn"><img src={opt.image} alt={opt.label} className="admin-option-image" /><span className="admin-option-label">{opt.label}</span></div>))}
                    </div>
                </section>
            )}

            <section className={`admin-card admin-leaderboard-section ${finished ? "leaderboard-results" : ""}`}>
                <h2><FaTrophy style={{ marginRight: 6 }} /> {finished ? "Final Leaderboard" : "Live Leaderboard"}</h2>
                {finished && leaderboard.length > 0 && (
                    <div className="podium-wrapper">
                        <div className="podium">
                            {leaderboard[1] && <div className="podium-col podium-silver"><div className="podium-medal">🥈</div><div className="podium-avatar">{getAvatar(leaderboard[1].name, 1, 50)}</div><div className="podium-name">{leaderboard[1].name}</div><div className="podium-points">{leaderboard[1].points} pts</div></div>}
                            {leaderboard[0] && <div className="podium-col podium-gold"><div className="podium-medal">🥇</div><div className="podium-avatar">{getAvatar(leaderboard[0].name, 0, 60)}</div><div className="podium-name">{leaderboard[0].name}</div><div className="podium-points">{leaderboard[0].points} pts</div></div>}
                            {leaderboard[2] && <div className="podium-col podium-bronze"><div className="podium-medal">🥉</div><div className="podium-avatar">{getAvatar(leaderboard[2].name, 2, 50)}</div><div className="podium-name">{leaderboard[2].name}</div><div className="podium-points">{leaderboard[2].points} pts</div></div>}
                        </div>
                    </div>
                )}
                <table className="admin-table leaderboard-table">
                    <thead><tr><th>Rank</th><th>Avatar</th><th>Name</th><th>Points</th></tr></thead>
                    <tbody>
                        {leaderboard.slice(finished ? 3 : 0, 10).map((row, idx) => {
                            const rank = (finished ? 4 : 1) + idx;
                            return (<tr key={row.pid} className={!finished ? `rank-${rank}` : 'leaderboard-topten'}><td>{rank}</td><td>{getAvatar(row.name, rank - 1)}</td><td>{row.name}</td><td>{row.points}</td></tr>);
                        })}
                    </tbody>
                </table>
                {leaderboard.length === 0 && <div>No scores yet.</div>}
            </section>
        </div>
    );
}