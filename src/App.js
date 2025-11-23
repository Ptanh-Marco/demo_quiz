import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from "react-router-dom";
import { HashRouter as Router, Routes, Route } from "react-router-dom";
import ParticipantQuiz from "./components/participant/ParticipantQuiz";
import AdminPanel from "./components/admin/AdminPanel";
import "./App.scss";

function App() {
    return (
        <Router>
            <nav style={{ margin: "20px" }}>
                <Link to="/participant" style={{ marginRight: "16px" }}>Participant View</Link>
                <Link to="/admin">Admin View</Link>
            </nav>
            <Routes>
                <Route path="/" element={<Navigate to="/participant" />} />
                <Route path="/participant" element={<ParticipantQuiz />} />
                <Route path="/admin" element={<AdminPanel />} />
            </Routes>
        </Router>
    );
}

export default App;