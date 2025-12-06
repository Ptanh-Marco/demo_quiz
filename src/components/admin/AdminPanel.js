import React, { useState, useEffect, useRef, useCallback } from "react";
import { db } from '../../config/firebaseConfig';
import { ref, onValue, set, remove, get, update, off } from "firebase/database";
import Confetti from "react-confetti";
import { QRCodeSVG } from "qrcode.react";
import "./AdminPanel.scss";
import LiveQuestionView from './LiveQuestionView';

// Helper: generate roomId
function generateRoomId(length = 7) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// ----------- Sub-components -----------

function AdminHeader({ title, roomCode, onStart, onReset, quizStarted }) {
    return (
        <header className="led-header">
            <div className="led-title">{title}</div>
            <div className="led-roomcode">Room: <span>{roomCode}</span></div>
            <div className="led-controls">
                {!quizStarted && <button className="led-btn start-btn" onClick={onStart}>Start Quiz</button>}
                <button className="led-btn reset-btn" onClick={onReset}>Reset</button>
            </div>
        </header>
    );
}

function RoomInfo({ roomCode, participantURL }) {
    return (
        <section className="led-roominfo">
            <div className="led-qr-sec">
                <QRCodeSVG value={participantURL} size={240} />
            </div>
            <div className="led-room-details">
                <div className="led-roomid-value">Room Code: <span>{roomCode}</span></div>
                <div className="led-url">{participantURL}</div>
                <div className="led-instruction">Scan QR code or enter URL to join!</div>
            </div>
        </section>
    );
}

function ParticipantGrid({ participants }) {
    return (
        <section className="led-participants">
            <h2 className="led-section-title">Participants Waiting</h2>
            <div className="led-participant-list">
                {participants.length === 0 && <div className="led-nobody">No one yet...</div>}
                {participants.map(p => (
                    <div className="led-participant-name" key={p.pid}>{p.name}</div>
                ))}
            </div>
        </section>
    );
}

function LiveQuestionDisplay({ question, timer, questionNumber, totalQuestions, answers, participants }) {
    return (
        <section className="led-question">
            <div className="led-question-number">
                Question {questionNumber} / {totalQuestions}
            </div>
            <div className="led-timer">
                Time Left: <span className={timer <= 5 ? "led-timer-low" : ""}>{timer}</span>s
            </div>
            <div className="led-question-text">{question.question}</div>
            {question.image && (
                <img className="led-question-image" src={question.image} alt="Question" />
            )}
            {/* --- Display Answers --- */}
            <div className="led-answers">
                <h3 style={{
                    fontSize: "1.5rem",
                    color: "#00695c",
                    margin: "28px 0 10px 0",
                    fontWeight: "700"
                }}>Participant Answers:</h3>
                <div className="led-answers-list">
                    {answers.length === 0 && (
                        <div style={{ color: "#aaa", fontSize: "1.2rem" }}>No answers yet.</div>
                    )}
                    {answers.map(a => (
                        <div className="led-answer-row" key={a.pid}>
                            <span className="led-answer-name">{participants.find(p => p.pid === a.pid)?.name || "?"}</span>
                            <span className="led-answer-text">{a.answer}</span>
                            <span className="led-answer-time">{a.timeToAnswer !== undefined ? `${a.timeToAnswer}s` : ""}</span>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

// Updated LeaderboardDisplay with 'live' prop and live CSS
function LeaderboardDisplay({ leaderboard, live }) {
    return (
        <section className={`led-leaderboard${live ? " led-leaderboard-live" : ""}`}>
            <h2 className="led-section-title">
                {live ? "🏆 Live Leaderboard 🏆" : "🏆 Final Leaderboard 🏆"}
            </h2>
            <div className="led-leaderboard-list">
                {leaderboard.map((item, idx) => (
                    <div
                        className={`led-leaderboard-row ${idx === 0 ? "led-winner" : ""}`}
                        key={item.pid}
                    >
                        <span className="led-leaderboard-rank">{idx + 1}</span>
                        <span className="led-leaderboard-name">{item.name}</span>
                        <span className="led-leaderboard-score">{item.points}</span>
                    </div>
                ))}
            </div>
            {!live && <div className="led-congrats">Congratulations!</div>}
        </section>
    );
}

function AdminFooter({ eventLogo, sponsorLogo }) {
    return (
        <footer className="led-footer">
            {eventLogo && <img src={eventLogo} alt="Event Logo" className="led-footer-logo" />}
            {sponsorLogo && <img src={sponsorLogo} alt="Sponsor Logo" className="led-footer-sponsor" />}
        </footer>
    );
}

// ----------- Main AdminPanel -----------

const QUESTION_TIME_LIMIT = 10;

export default function AdminPanel() {
    // --- STATE ---
    const [roomId, setRoomId] = useState("");
    const [roomCreated, setRoomCreated] = useState(false);
    const [participants, setParticipants] = useState([]);
    const [questions, setQuestions] = useState([]);
    const [leaderboard, setLeaderboard] = useState([]);
    const [quizState, setQuizState] = useState({
        started: false,
        finished: false,
        currentQuestionIndex: 0,
        timer: QUESTION_TIME_LIMIT
    });
    const [windowSize, setWindowSize] = useState({
        width: window.innerWidth,
        height: window.innerHeight
    });
    const [currentAnswers, setCurrentAnswers] = useState([]);

    // For time/logic
    const isProcessingRef = useRef(false);
    const quizStateRef = useRef(quizState);
    useEffect(() => { quizStateRef.current = quizState; }, [quizState]);

    // --- Load questions ---
    useEffect(() => {
        const questionsRef = ref(db, "questions");
        const unsubQuestions = onValue(questionsRef, snap => {
            const qObj = snap.val();
            setQuestions(
                qObj
                    ? Object.entries(qObj).map(([id, q]) => ({ ...q, id }))
                    : []
            );
        });
        return () => unsubQuestions();
    }, []);

    // --- Listen for participants, quizState, scores for the current room ---
    useEffect(() => {
        if (!roomCreated || !roomId) return;
        const participantsRef = ref(db, `rooms/${roomId}/participants`);
        const quizStateDbRef = ref(db, `rooms/${roomId}/quizState`);
        const scoresRef = ref(db, `rooms/${roomId}/scores`);
        const unsubParticipants = onValue(participantsRef, snap =>
            setParticipants(Object.entries(snap.val() || {}).map(([pid, v]) => ({ pid, ...v }))
            ));
        const unsubQuizState = onValue(quizStateDbRef, snap => {
            setQuizState(
                snap.val() || {
                    started: false,
                    finished: false,
                    currentQuestionIndex: 0,
                    timer: QUESTION_TIME_LIMIT
                }
            );
        });
        const unsubScores = onValue(scoresRef, async scoresSnap => {
            const scores = scoresSnap.val() || {};
            const participantsSnap = await get(participantsRef);
            const participantsObj = participantsSnap.val() || {};
            const board = Object.keys(scores)
                .map(pid => ({
                    name: participantsObj[pid]?.name || "Unknown",
                    points: Object.values(scores[pid]?.perQuestion || {}).reduce((a, b) => a + b, 0),
                    pid
                }))
                .sort((a, b) => b.points - a.points);
            setLeaderboard(board);
        });
        return () => {
            off(participantsRef);
            off(quizStateDbRef);
            off(scoresRef);
        };
    }, [roomId, roomCreated]);

    // --- Answers for current question ---
    useEffect(() => {
        if (!roomCreated || !roomId || !quizState.started) {
            setCurrentAnswers([]);
            return;
        }
        const q = questions[quizState.currentQuestionIndex];
        if (!q?.id) return;
        const answersRef = ref(db, `rooms/${roomId}/quizState/answers`);
        const unsubAnswers = onValue(answersRef, (snap) => {
            const allAnswers = snap.val() || {};
            // Map answer objects for the current question
            const answerList = Object.entries(allAnswers).map(([pid, answerObj]) => ({
                pid,
                answer: answerObj[q.id]?.answer,
                timeToAnswer: answerObj[q.id]?.timeToAnswer
            })).filter(a => a.answer !== undefined);
            setCurrentAnswers(answerList);
        });
        return () => unsubAnswers();
    }, [roomId, roomCreated, quizState.started, quizState.currentQuestionIndex, questions]);

    // --- Master Clock ---
    useEffect(() => {
        if (!quizState.started || quizState.finished) return;
        if (quizState.timer <= 0) {
            handleEndOfQuestion();
            return;
        }
        const timerId = setInterval(() => {
            const newTime = quizStateRef.current.timer - 1;
            set(ref(db, `rooms/${roomId}/quizState/timer`), newTime);
        }, 1000);
        return () => clearInterval(timerId);
    }, [quizState.started, quizState.finished, quizState.timer, roomId]);

    // --- Scoring & Question Logic ---
    const handleEndOfQuestion = useCallback(async () => {
        if (isProcessingRef.current) return;
        isProcessingRef.current = true;
        const questionIndexToProcess = quizStateRef.current.currentQuestionIndex;
        const q = questions[questionIndexToProcess];
        const qid = q?.id;
        try {
            if (q && qid) {
                const allAnswersSnap = await get(ref(db, `rooms/${roomId}/quizState/answers`));
                const allAnswers = allAnswersSnap.val() || {};
                const participantsSnap = await get(ref(db, `rooms/${roomId}/participants`));
                const participantsObj = participantsSnap.val() || {};
                const correctParticipants = Object.keys(participantsObj)
                    .map(pid => {
                        const ansObj = allAnswers[pid]?.[qid] || {};
                        let isCorrect;
                        if (Array.isArray(q.correct)) {
                            isCorrect = q.correct.some(
                                ans =>
                                    ans.trim().toLowerCase() ===
                                    (ansObj.answer || "").trim().toLowerCase()
                            );
                        } else {
                            isCorrect =
                                (ansObj.answer || "").trim().toLowerCase() ===
                                (q.correct || "").trim().toLowerCase();
                        }
                        return isCorrect
                            ? {
                                pid,
                                timeToAnswer: ansObj.timeToAnswer ?? QUESTION_TIME_LIMIT
                            }
                            : null;
                    })
                    .filter(Boolean);
                correctParticipants.sort((a, b) => a.timeToAnswer - b.timeToAnswer);
                const N = correctParticipants.length;
                const S = N > 0 ? (N * (N + 1)) / 2 : 1;
                const updates = {};
                correctParticipants.forEach((p, i) => {
                    updates[`rooms/${roomId}/scores/${p.pid}/perQuestion/${questionIndexToProcess}`] =
                        Math.round((1000 * (N - i)) / S);
                });
                if (Object.keys(updates).length > 0) await update(ref(db), updates);
            }
            const nextIndex = questionIndexToProcess + 1;
            if (nextIndex < questions.length) {
                set(ref(db, `rooms/${roomId}/quizState`), {
                    ...quizStateRef.current,
                    currentQuestionIndex: nextIndex,
                    timer: QUESTION_TIME_LIMIT
                });
            } else {
                set(ref(db, `rooms/${roomId}/quizState/finished`), true);
            }
        } catch (error) {
            console.error("Error processing end of question:", error);
        } finally {
            isProcessingRef.current = false;
        }
    }, [questions, roomId]);

    // --- Start Quiz ---
    const startQuiz = async () => {
        if (questions.length === 0) {
            alert("Cannot start quiz with no questions.");
            return;
        }
        const quizStartTime = Date.now();
        const initialQuizState = {
            started: true,
            finished: false,
            currentQuestionIndex: 0,
            timer: QUESTION_TIME_LIMIT,
            startTime: quizStartTime,
        };
        await Promise.all([
            set(ref(db, `rooms/${roomId}/quizState`), initialQuizState),
            remove(ref(db, `rooms/${roomId}/scores`)),
            remove(ref(db, `rooms/${roomId}/quizState/answers`))
        ]);
    };

    // --- Reset Quiz ---
    const resetQuiz = async () => {
        if (
            window.confirm(
                "Are you sure you want to fully reset the quiz? This will remove ALL participants and clear all progress."
            )
        ) {
            try {
                const initialQuizState = {
                    started: false,
                    finished: false,
                    currentQuestionIndex: 0,
                    timer: QUESTION_TIME_LIMIT
                };
                await Promise.all([
                    set(ref(db, `rooms/${roomId}/quizState`), initialQuizState),
                    remove(ref(db, `rooms/${roomId}/participants`)),
                    remove(ref(db, `rooms/${roomId}/scores`)),
                    remove(ref(db, `rooms/${roomId}/quizState/answers`))
                ]);
            } catch (error) {
                console.error("Failed to reset quiz:", error);
                alert(
                    "An error occurred while resetting the quiz. Please check the console for details."
                );
            }
        }
    };

    useEffect(() => {
        const handleResize = () =>
            setWindowSize({
                width: window.innerWidth,
                height: window.innerHeight
            });
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    // --- Room Creation UI ---
    if (!roomCreated) {
        return (
            <div className="led-admin-root">
                <AdminHeader
                    title="Football Fans Quiz"
                    roomCode="---"
                    onStart={() => { }} // Disabled
                    onReset={() => { }} // Disabled
                    quizStarted={false}
                />
                <section className="led-roominfo">
                    <button className="led-btn start-btn"
                        style={{ fontSize: "2.2rem", padding: "1em 2em", marginTop: "60px" }}
                        onClick={async () => {
                            const newRoomId = generateRoomId();
                            setRoomId(newRoomId);
                            await set(ref(db, `rooms/${newRoomId}`), {
                                created: Date.now(),
                                status: "waiting"
                            });
                            setRoomCreated(true);
                        }}>
                        Generate Room
                    </button>
                </section>
            </div>
        );
    }

    // --- Main LED Structure ---
    const basePath = process.env.PUBLIC_URL || '/';
    const participantURL = `${window.location.origin}${basePath}/#/participant?roomId=${roomId}`;
    const currentQuestion = questions[quizState.currentQuestionIndex];

    return (
        <div className="led-admin-root">
            {quizState.finished && (
                <Confetti
                    width={windowSize.width}
                    height={windowSize.height}
                    recycle={false}
                    numberOfPieces={800}
                />
            )}
            <AdminHeader
                title="Football Fans Quiz"
                roomCode={roomId}
                onStart={startQuiz}
                onReset={resetQuiz}
                quizStarted={quizState.started}
            />
            {!quizState.started && (
                <>
                    <RoomInfo
                        roomCode={roomId}
                        participantURL={participantURL}
                    />
                    <ParticipantGrid participants={participants} />
                </>
            )}
            {quizState.started && !quizState.finished && currentQuestion && (
                <>
                    <LiveQuestionView
                        question={currentQuestion}
                        timer={quizState.timer}
                        currentQuestionIndex={quizState.currentQuestionIndex}
                        totalQuestions={questions.length}
                        answers={currentAnswers}
                        participants={participants}
                    />
                </>
            )}
            {/* Live leaderboard shown fixed at top-right during quiz */}
            {quizState.started && !quizState.finished && (
                <LeaderboardDisplay leaderboard={leaderboard} live />
            )}
            {/* Final leaderboard shown at end of quiz */}
            {quizState.finished && (
                <LeaderboardDisplay leaderboard={leaderboard} live={false} />
            )}
            <AdminFooter eventLogo={null} sponsorLogo={null} />
        </div>
    );
}