import React, { useState, useEffect } from "react";
import { db } from "src/config/firebaseConfig";
import { ref, onValue, push, set, get } from "firebase/database";
import Confetti from "react-confetti";
import "./ParticipantQuiz.scss";

const QUESTION_TIME_LIMIT = 15;

export default function ParticipantQuiz() {
    // --- STATE MANAGEMENT (Unchanged) ---
    const [username, setUsername] = useState("");
    const [participantId, setParticipantId] = useState(sessionStorage.getItem("participantId"));
    const [quizState, setQuizState] = useState({
        status: participantId ? "waiting" : "joining",
        currentQuestionIndex: 0,
        timer: QUESTION_TIME_LIMIT,
    });
    const [questions, setQuestions] = useState([]);
    const [answers, setAnswers] = useState({});
    const [myScore, setMyScore] = useState(0);
    const [myRank, setMyRank] = useState(0);
    const [totalParticipants, setTotalParticipants] = useState(0);
    const [blocked, setBlocked] = useState(false);
    const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });

    // --- CORE LOGIC & SIDE EFFECTS (Unchanged) ---
    const handleJoin = async () => {
        if (!username.trim()) {
            alert("Please enter your name!");
            return;
        }
        const quizStateSnap = await get(ref(db, "quizState/started"));
        if (quizStateSnap.val() === true) {
            setBlocked(true);
            return;
        }
        const pRef = push(ref(db, "participants"));
        set(pRef, { name: username, joined: Date.now() });
        setParticipantId(pRef.key);
        sessionStorage.setItem("participantId", pRef.key);
        setQuizState((prev) => ({ ...prev, status: "waiting" }));
    };

    const handlePlayAgain = () => {
        sessionStorage.removeItem("participantId");
        setParticipantId(null);
        setUsername("");
        setAnswers({});
        setMyScore(0);
        setMyRank(0);
        setQuizState({ status: "joining", currentQuestionIndex: 0, timer: QUESTION_TIME_LIMIT });
    };

    useEffect(() => {
        const quizStateRef = ref(db, "quizState");
        const unsubscribe = onValue(quizStateRef, (snap) => {
            const state = snap.val() || {};
            if (state.finished) {
                setQuizState((prev) => ({ ...prev, status: "finished" }));
            } else if (state.started) {
                setQuizState((prev) => ({
                    ...prev,
                    status: "playing",
                    currentQuestionIndex: state.currentQuestionIndex || 0,
                    timer: state.timer || QUESTION_TIME_LIMIT,
                }));
            } else {
                if (quizState.status === 'playing' || quizState.status === 'finished') {
                    handlePlayAgain();
                }
            }
        });
        return () => unsubscribe();
    }, [quizState.status]);

    useEffect(() => {
        if (quizState.status === "playing") {
            const questionsRef = ref(db, "questions");
            const unsubscribe = onValue(questionsRef, (snap) => {
                const qObj = snap.val();
                setQuestions(qObj ? Object.entries(qObj).map(([id, q]) => ({ ...q, id })) : []);
            });
            return () => unsubscribe();
        }
    }, [quizState.status]);

    useEffect(() => {
        if (!participantId) return;
        const myScoreRef = ref(db, `scores/${participantId}/perQuestion`);
        const unsubMyScore = onValue(myScoreRef, (snap) => {
            const myQuestionScores = snap.val() || {};
            const total = Object.values(myQuestionScores).reduce((a, b) => a + b, 0);
            setMyScore(total);
        });
        const allScoresRef = ref(db, "scores");
        const unsubAllScores = onValue(allScoresRef, (snap) => {
            const allScores = snap.val() || {};
            setTotalParticipants(Object.keys(allScores).length);
            const board = Object.entries(allScores).map(([pid, data]) => ({
                pid,
                points: Object.values(data.perQuestion || {}).reduce((a, b) => a + b, 0),
            }));
            board.sort((a, b) => b.points - a.points);
            const myRankIndex = board.findIndex((p) => p.pid === participantId);
            setMyRank(myRankIndex !== -1 ? myRankIndex + 1 : 0);
        });
        return () => {
            unsubMyScore();
            unsubAllScores();
        };
    }, [participantId]);

    useEffect(() => {
        const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const handleSubmitAnswer = (questionId, answer) => {
        if (!participantId || answers[questionId]) return;
        set(ref(db, `quizState/answers/${participantId}/${questionId}`), {
            answer: answer,
            answeredAt: Date.now(),
            timeToAnswer: QUESTION_TIME_LIMIT - quizState.timer,
        });
        setAnswers((prev) => ({ ...prev, [questionId]: answer }));
    };

    const q = questions[quizState.currentQuestionIndex];
    const hasAnsweredCurrent = q && !!answers[q.id];

    // --- RENDER LOGIC ---
    return (
        <div className={`participant-container screen-${quizState.status}`}>
            {quizState.status === 'finished' && <Confetti width={windowSize.width} height={windowSize.height} recycle={false} numberOfPieces={400} />}

            {blocked && (
                <div className="card blocked-card">
                    <h2>Quiz has already started.</h2>
                    <p>You cannot join now. Please wait for the admin to reset the quiz.</p>
                </div>
            )}

            {!blocked && (
                <>
                    {/* Screens 1, 2 (Unchanged) */}
                    <div className="screen join-screen">
                        <div className="card join-card">
                            <h1>Football Fans Quiz</h1>
                            <p>Enter your name to join the fun!</p>
                            <div className="join-form">
                                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Your Name" className="username-input" />
                                <button onClick={handleJoin} className="join-btn">Join Quiz</button>
                            </div>
                        </div>
                    </div>
                    <div className="screen waiting-screen">
                        <div className="card">
                            <h2>Welcome, {username || "Participant"}!</h2>
                            <p>You're in! Get ready...</p>
                            <div className="loader"></div>
                            <p>Waiting for the admin to start the quiz.</p>
                        </div>
                    </div>

                    {/* Screen 3: Playing (*** UPDATED ***) */}
                    <div className="screen playing-screen">
                        {!q ? (
                            <div className="loader"></div>
                        ) : (
                            <div className="card quiz-card">
                                <header className="quiz-header">
                                    <div className="question-counter">Question {quizState.currentQuestionIndex + 1} / {questions.length}</div>
                                    <div className={`timer ${quizState.timer <= 5 ? 'low-time' : ''}`}>{quizState.timer}</div>
                                    <div className="live-score">Score: <strong>{myScore}</strong></div>
                                </header>
                                <main className="quiz-body">
                                    {q.image && <img className="question-image" src={q.image} alt="Question visual" />}
                                    <h2 className="question-text">{q.question}</h2>
                                    <div className="options-container">
                                        {/* single_choice */}
                                        {q.type === "single_choice" &&
                                            q.options.map((opt) => (
                                                <button key={opt} className={`option-btn ${answers[q.id] === opt ? "selected" : ""} ${hasAnsweredCurrent ? "answered" : ""}`} disabled={hasAnsweredCurrent} onClick={() => handleSubmitAnswer(q.id, opt)}>
                                                    {opt}
                                                </button>
                                            ))}
                                        {/* fill_text */}
                                        {q.type === "fill_text" && (
                                            <form className="text-answer-form" onSubmit={(e) => { e.preventDefault(); handleSubmitAnswer(q.id, e.target.answer.value); }}>
                                                <input type="text" name="answer" className="text-input" disabled={hasAnsweredCurrent} placeholder="Type your answer..." />
                                                <button type="submit" className="submit-btn" disabled={hasAnsweredCurrent}>Submit</button>
                                            </form>
                                        )}
                                        {/* *** NEW: image_choice logic for object format *** */}
                                        {q.type === "image_choice" &&
                                            q.options.map((option) => (
                                                <button
                                                    key={option.label}
                                                    className={`option-image-btn ${answers[q.id] === option.label ? "selected" : ""} ${hasAnsweredCurrent ? "answered" : ""}`}
                                                    disabled={hasAnsweredCurrent}
                                                    onClick={() => handleSubmitAnswer(q.id, option.label)}
                                                >
                                                    <img src={option.image} alt={option.label} className="option-image" />
                                                    <span className="option-label">{option.label}</span>
                                                </button>
                                            ))}
                                    </div>
                                    {hasAnsweredCurrent && <div className="answer-feedback">Answer locked! Waiting for next question...</div>}
                                </main>
                            </div>
                        )}
                    </div>

                    {/* Screen 4: Finished (Unchanged) */}
                    <div className="screen finished-screen">
                        <div className="card achievement-card">
                            <h2>🎉 Quiz Finished! 🎉</h2>
                            <p>Well done, {username || "Participant"}!</p>
                            <div className="final-score-rank">
                                <div className="result-box"><span>Your Score</span><strong>{myScore}</strong></div>
                                <div className="result-box"><span>Your Rank</span><strong>{myRank} / {totalParticipants}</strong></div>
                            </div>
                            <button className="play-again-btn" onClick={handlePlayAgain}>Play Again</button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}