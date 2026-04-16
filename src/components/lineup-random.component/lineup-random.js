import React, { useState, useRef, useEffect } from "react";
import Papa from "papaparse";
import { Wheel } from "react-custom-roulette";
import { db } from '../../config/firebaseConfig';
import { ref, get, runTransaction } from "firebase/database";

// Settings
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRfoixF4aaxwn2SzzIY6bC2ACiUMqkk54kLtNNfCvLSlDWKBlQ6Zu0GSdPRPFVeYonpbBpv0b4D1ajv/pub?gid=1577263884&single=true&output=csv";
const TEAM_COUNT = 3;

// Utility
function tierSortKey(tier) {
    if (tier === "GK") return -Infinity;
    const match = tier.match(/^Tier\s*([0-9.\u221E♾️∞]+)/i);
    if (match) {
        if (match[1] === "♾️" || match[1] === "∞" || match[1] === "\u221E") return 99999;
        return parseFloat(match[1]);
    }
    return 9999;
}

// Realtime Database Count Helpers
function getTodayString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

async function incrementRandomCount() {
    const today = getTodayString();
    const counterRef = ref(db, `randomCounts/${today}`);
    await runTransaction(counterRef, current => (current || 0) + 1);
}

async function getRandomCountToday() {
    const today = getTodayString();
    const counterRef = ref(db, `randomCounts/${today}`);
    const snap = await get(counterRef);
    return snap.exists() ? snap.val() : 0;
}

// Display helpers
function PlayerList({ players, tierOrder }) {
    const grouped = {};
    tierOrder.forEach((tier) => {
        grouped[tier] = players.filter((p) => p.tier === tier).map((p) => p.name);
    });
    const maxRows = Math.max(
        ...tierOrder.map((tier) => (grouped[tier] ? grouped[tier].length : 0))
    );
    return (
        <table style={{ margin: "auto", borderCollapse: "collapse", marginBottom: 24, background: "#fff" }}>
            <thead>
                <tr>
                    {tierOrder.map((tier) => (
                        <th key={tier} style={{ border: "1px solid #ccc", padding: 6, background: "#f7f7f7", minWidth: 90 }}>
                            {tier}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {[...Array(maxRows)].map((_, rowIdx) => (
                    <tr key={rowIdx}>
                        {tierOrder.map((tier) => (
                            <td key={tier} style={{ border: "1px solid #ccc", padding: 6, minWidth: 90, textAlign: "center" }}>
                                {grouped[tier][rowIdx] || ""}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
function TeamsDisplay({ teams = [], teamTierOrder }) {
    const maxRows = Math.max(...teams.map(team => team.length), teamTierOrder.length);
    return (
        <div style={{ margin: "32px auto", maxWidth: 900 }}>
            <table style={{
                margin: "auto",
                borderCollapse: "collapse",
                background: "#fff",
                boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
                borderRadius: 12,
                overflow: "hidden",
                width: "100%",
                minWidth: 350,
            }}>
                <thead>
                    <tr>
                        {teams.map((team, idx) => (
                            <th key={idx}
                                style={{
                                    border: "1px solid #ccc",
                                    padding: "12px 0",
                                    fontSize: 17,
                                    background: "#1565c0",
                                    color: "#fff",
                                    minWidth: 120,
                                    borderRight: idx === teams.length - 1 ? "none" : "1px solid #ccc"
                                }}>
                                🏅 Team {idx + 1}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {[...Array(maxRows)].map((_, rowIdx) => (
                        <tr key={rowIdx}>
                            {teams.map((team, colIdx) => {
                                const player = team[rowIdx];
                                return (
                                    <td key={colIdx}
                                        style={{
                                            border: "1px solid #eee",
                                            padding: "9px 0",
                                            textAlign: "center",
                                            minWidth: 120,
                                            fontSize: 15,
                                            background: player ? "#f5f8ff" : "#fff"
                                        }}>
                                        {player
                                            ? (
                                                <span>
                                                    <span style={{
                                                        fontWeight: 500,
                                                        marginRight: 6
                                                    }}>{player.name}</span>
                                                    <span style={{
                                                        background: "#e3e3e3",
                                                        borderRadius: 6,
                                                        padding: "2px 7px",
                                                        color: "#1565c0",
                                                        fontSize: 13,
                                                        fontWeight: 400
                                                    }}>
                                                        {player.tier}
                                                    </span>
                                                </span>
                                            )
                                            : null
                                        }
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// Normalize Vietnamese names before comparing (handles NFC/NFD differences from CSV)
function normName(s) {
    return s.normalize("NFC").trim();
}

// Conflict check: returns true if playerName conflicts with any member of team
function hasConflict(playerName, team, exceptPairs) {
    const pNorm = normName(playerName);
    return team.some(member => {
        const mNorm = normName(member.name);
        return exceptPairs.some(([a, b]) => {
            const aN = normName(a), bN = normName(b);
            return (aN === pNorm && bN === mNorm) ||
                   (bN === pNorm && aN === mNorm);
        });
    });
}

function LineUpRandom() {
    // Data state
    const [players, setPlayers] = useState([]);
    const [teams, setTeams] = useState(() => Array.from({ length: TEAM_COUNT }, () => []));
    const [div3Tiers, setDiv3Tiers] = useState([]);
    const [remTiers, setRemTiers] = useState([]);
    const [sortedTiers, setSortedTiers] = useState([]);
    const [currentTierIdx, setCurrentTierIdx] = useState(0);

    // UI state
    const [isSynced, setIsSynced] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);

    // Wheel state
    const [mustSpin, setMustSpin] = useState(false);
    const [prizeNumber, setPrizeNumber] = useState(0);

    // Assignment state
    const assignedNamesRef = useRef(new Set());
    const tierPlayersRef = useRef([]);
    const [roundPlayers, setRoundPlayers] = useState([]);
    const [teamInRound, setTeamInRound] = useState(0);
    const [remainderPlayers, setRemainderPlayers] = useState([]);
    const [remainderIdx, setRemainderIdx] = useState(0);
    const advancingTier = useRef(false);
    const wheelPoolRef = useRef([]); // tracks what the current wheel is actually showing
    const selectedRef = useRef(null); // stores the actual player picked when prizeNumber is set

    // Randomization count state
    const [randomCountToday, setRandomCountToday] = useState(0);

    // Except pairs: players that must never end up on the same team
    const [exceptPairs, setExceptPairs] = useState([["Mai Lê Khanh", "Warren Dương Nguyễn"]]);

    // For "count only once per process"
    const hasCountedRef = useRef(false);

    // Load today's count on mount
    useEffect(() => {
        getRandomCountToday().then(setRandomCountToday);
    }, []);

    // Fetch players from Google Sheet
    async function fetchPlayersFromSheet() {
        const response = await fetch(CSV_URL);
        const csv = await response.text();
        let csvLines = csv.split('\n');
        if (csvLines.length <= 3) {
            return []; // Not enough data
        }
        csvLines = csvLines.slice(3).filter(line => line.trim() !== "");
        if (csvLines.length === 0) {
            return [];
        }
        const cleanedCsv = csvLines.join('\n');
        const { data } = Papa.parse(cleanedCsv, {
            header: true,
            skipEmptyLines: true
        });
        return data
            .filter(p =>
                p && typeof p === 'object' &&
                'Danh sách' in p && 'Tier' in p &&
                p["Danh sách"] && p.Tier
            )
            .map(p => ({
                name: p["Danh sách"],
                tier: p.Tier,
            }));
    }

    // Sync button
    const syncData = async () => {
        setIsSynced(false);
        setPlayers([]);
        setTeams(Array.from({ length: TEAM_COUNT }, () => []));
        setDiv3Tiers([]);
        setRemTiers([]);
        setSortedTiers([]);
        setCurrentTierIdx(0);
        setRoundPlayers([]);
        setTeamInRound(0);
        setRemainderPlayers([]);
        setRemainderIdx(0);
        setMustSpin(false);
        setHasStarted(false);
        assignedNamesRef.current = new Set();

        const data = await fetchPlayersFromSheet();
        setPlayers(data);

        const foundTiers = Array.from(
            new Set(data.map((p) => p.tier).filter(Boolean))
        );
        const sortedTiersRaw = foundTiers.slice().sort((a, b) => tierSortKey(a) - tierSortKey(b));
        const byTier = {};
        data.forEach(p => {
            if (!byTier[p.tier]) byTier[p.tier] = [];
            byTier[p.tier].push(p);
        });
        const div3 = sortedTiersRaw.filter(t => byTier[t].length % TEAM_COUNT === 0);
        const rem = sortedTiersRaw.filter(t => byTier[t].length % TEAM_COUNT !== 0);

        setDiv3Tiers(div3);
        setRemTiers(rem);
        setSortedTiers([...div3, ...rem]);
        setIsSynced(true);
    };

    // Advance tier
    function advanceTier() {
        advancingTier.current = true;
        setCurrentTierIdx(idx => idx + 1);
        setRoundPlayers([]);
        setTeamInRound(0);
        setRemainderPlayers([]);
        setRemainderIdx(0);
        assignedNamesRef.current = new Set();
        setTimeout(() => {
            advancingTier.current = false;
        }, 350);
    }

    // On tier change, set up tier player list
    useEffect(() => {
        if (!isSynced || currentTierIdx >= sortedTiers.length) return;
        assignedNamesRef.current = new Set();
        setRoundPlayers([]);
        setTeamInRound(0);
        setRemainderPlayers([]);
        setRemainderIdx(0);
        tierPlayersRef.current = players.filter((p) => p.tier === sortedTiers[currentTierIdx]);
        // If already started, auto-start the first round of new tier
        if (hasStarted) {
            setTimeout(() => {
                startFirstRound();
            }, 400);
        }
        // eslint-disable-next-line
    }, [currentTierIdx, isSynced, players, sortedTiers]);

    // Start process
    function startFirstRound() {
        if (currentTierIdx === 0) setTeams(Array.from({ length: TEAM_COUNT }, () => []));
        setRoundPlayers([]);
        setTeamInRound(0);
        setRemainderPlayers([]);
        setRemainderIdx(0);

        // Build first round pool
        const tierPlayers = tierPlayersRef.current;
        const available = tierPlayers.filter(p => !assignedNamesRef.current.has(p.name));
        const tier = sortedTiers[currentTierIdx];

        if (available.length >= TEAM_COUNT) {
            setRoundPlayers([...available]);
            setTeamInRound(0);
            setTimeout(() => setMustSpin(true), 350);
        } else if (!div3Tiers.includes(tier) && available.length > 0) {
            setRemainderPlayers([...available]);
            setRemainderIdx(0);
        }
    }

    // Next round or leftover
    function startNextRound() {
        const tier = sortedTiers[currentTierIdx];
        const tierPlayers = tierPlayersRef.current;
        const available = tierPlayers.filter(p => !assignedNamesRef.current.has(p.name));

        if (div3Tiers.includes(tier)) {
            if (available.length > 0) {
                setRoundPlayers([...available]);
                setTeamInRound(0);
                setTimeout(() => setMustSpin(true), 350);
            } else {
                setTimeout(() => advanceTier(), 700);
            }
            return;
        }
        if (available.length >= TEAM_COUNT) {
            setRoundPlayers([...available]);
            setTeamInRound(0);
            setTimeout(() => setMustSpin(true), 350);
        } else if (available.length > 0) {
            setRemainderPlayers([...available]);
            setRemainderIdx(0);
        } else {
            setTimeout(() => advanceTier(), 700);
        }
    }

    // Wheel data — round mode shows ALL players (conflict resolved silently after spin stops)
    let wheelData = [];
    let assignMode = null;
    if (roundPlayers.length > 0 && teamInRound < TEAM_COUNT) {
        wheelPoolRef.current = [...roundPlayers];
        wheelData = roundPlayers.map((p) => ({ option: p.name }));
        assignMode = "round";
    } else if (remainderPlayers.length > 0 && remainderIdx < remainderPlayers.length) {
        const minSize = Math.min(...teams.map(team => team.length));
        const eligibleTeams = teams
            .map((team, idx) => (team.length === minSize ? idx : null))
            .filter((idx) => idx !== null);
        // Remainder: silently prefer non-conflicting teams, but show all eligible teams on wheel
        wheelPoolRef.current = eligibleTeams;
        wheelData = eligibleTeams.map((idx) => ({ option: `Team ${idx + 1}` }));
        assignMode = "remainder";
    }

    // Handle wheel stop — team always follows spin order: Team 1 → 2 → 3
    function handleWheelStop() {
        const sel = selectedRef.current;
        if (!sel) return;
        if (sel.type === "round") {
            const player = sel.player;
            const assignTeamIdx = teamInRound; // strict 0→1→2 order

            assignedNamesRef.current.add(player.name);
            setTeams(prevTeams =>
                prevTeams.map((team, idx) =>
                    idx === assignTeamIdx ? [...team, player] : team
                )
            );
            setMustSpin(false);
            selectedRef.current = null;
            const nextPlayers = roundPlayers.filter(p => p.name !== player.name);
            if (teamInRound + 1 < TEAM_COUNT) {
                setRoundPlayers(nextPlayers);
                setTeamInRound(teamInRound + 1);
            } else {
                setRoundPlayers([]);
                setTeamInRound(0);
                setTimeout(startNextRound, 350);
            }
        } else if (sel.type === "remainder") {
            const player = remainderPlayers[remainderIdx];
            const pool = wheelPoolRef.current;
            let teamIdx = pool[sel.poolIdx];
            // Silently pick a non-conflicting team if possible
            const safe = pool.find(t => !hasConflict(player.name, teams[t], exceptPairs));
            if (safe !== undefined) teamIdx = safe;

            assignedNamesRef.current.add(player.name);
            setTeams(prevTeams =>
                prevTeams.map((team, idx) =>
                    idx === teamIdx ? [...team, player] : team
                )
            );
            setMustSpin(false);
            selectedRef.current = null;
            if (remainderIdx + 1 < remainderPlayers.length) {
                setRemainderIdx(i => i + 1);
            } else {
                setRemainderPlayers([]);
                setRemainderIdx(0);
                setTimeout(startNextRound, 350);
            }
        }
    }

    // Wheel spin triggers
    useEffect(() => {
        if (!hasStarted) return;
        if (assignMode === "round" && roundPlayers.length > 0 && teamInRound < TEAM_COUNT) {
            if (wheelData.length === 0) return;
            // Silently pick from non-conflicting players for the current team.
            // The wheel still shows ALL players — it just "happens" to land on a safe one.
            const safePool = roundPlayers.filter(p => !hasConflict(p.name, teams[teamInRound], exceptPairs));
            const pickFrom = safePool.length > 0 ? safePool : roundPlayers; // fallback if all conflict
            const picked = pickFrom[Math.floor(Math.random() * pickFrom.length)];
            const idx = roundPlayers.findIndex(p => p.name === picked.name);
            selectedRef.current = { type: "round", player: picked };
            setPrizeNumber(idx);
            setTimeout(() => setMustSpin(true), 350);
        }
        if (assignMode === "remainder") {
            if (remainderPlayers.length === 0 || remainderIdx >= remainderPlayers.length) return;
            if (wheelData.length === 0) return;
            const idx = Math.floor(Math.random() * wheelData.length);
            selectedRef.current = { type: "remainder", poolIdx: idx };
            setPrizeNumber(idx);
            setTimeout(() => setMustSpin(true), 350);
        }
        // eslint-disable-next-line
    }, [roundPlayers, teamInRound, assignMode, remainderPlayers.length, remainderIdx, wheelData.length, hasStarted]);

    // Detect assignment complete
    const allAssigned = isSynced && hasStarted && (
        currentTierIdx >= sortedTiers.length
    );

    // Count only once per process
    useEffect(() => {
        if (allAssigned && !hasCountedRef.current) {
            incrementRandomCount().then(() => {
                setRandomCountToday(c => c + 1);
                hasCountedRef.current = true;
            });
        }
        if (!allAssigned) {
            hasCountedRef.current = false;
        }
    }, [allAssigned]);

    // Display info
    let displayPlayer = null;
    if (!hasStarted) {
        displayPlayer = "Press 'Start Random' to begin assignment!";
    } else if (assignMode === "round" && roundPlayers.length > 0 && teamInRound < TEAM_COUNT) {
        displayPlayer = `Spin: Which player for Team ${teamInRound + 1}`;
    } else if (assignMode === "remainder" && remainderPlayers.length > 0 && remainderIdx < remainderPlayers.length) {
        displayPlayer = `Assigning ${remainderPlayers[remainderIdx].name} (spin for team with smallest roster)`;
    }

    return (
        <div style={{ maxWidth: 1200, margin: "40px auto", textAlign: "center" }}>
            <h2>Futsal Team Randomizer</h2>
            <div style={{ marginBottom: 12 }}>
                Today's Randomizations: <b>{randomCountToday}</b>
            </div>
            <button onClick={syncData}>Sync Data from Google Sheet</button>
            <button
                style={{ marginLeft: 16, fontWeight: "bold", color: "#1976d2", background: "#fff" }}
                disabled={!isSynced || hasStarted}
                onClick={() => {
                    setHasStarted(true);
                    startFirstRound();
                }}
            >Start Random</button>
            {isSynced && (
                <>
                <div
                    style={{
                        display: "flex",
                        gap: 40,
                        alignItems: "flex-start",
                        justifyContent: "center",
                        marginTop: 32
                    }}
                >
                    <div style={{ flex: 1, minWidth: 340 }}>
                        <h3>Player List</h3>
                        <PlayerList players={players} tierOrder={[...div3Tiers, ...remTiers]} />
                        <b>Team 1 mặc áo bib đỏ, Team 2 mặc áo bib xanh, Team 3 mặc áo đồng phục</b>
                        <TeamsDisplay
                            teams={teams}
                            teamTierOrder={[...div3Tiers, ...remTiers]}
                        />
                    </div>
                    <div
                        style={{
                            minWidth: 380,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <h3>Random Selection</h3>
                        {allAssigned ? (
                            <div>All players assigned!</div>
                        ) : (
                            <>
                                {displayPlayer && (
                                    <div style={{ fontWeight: 'bold', fontSize: 18, marginBottom: 12 }}>
                                        {displayPlayer}
                                    </div>
                                )}
                                {hasStarted && wheelData.length > 0 ? (
                                    <div style={{
                                        width: 300,
                                        height: 300,
                                        transform: "scale(1)",
                                        transformOrigin: "top left",
                                        margin: "0 auto"
                                    }}>
                                        <Wheel
                                            mustStartSpinning={mustSpin}
                                            prizeNumber={prizeNumber}
                                            data={wheelData}
                                            onStopSpinning={handleWheelStop}
                                            backgroundColors={["#FFDDCC", "#CCF2FF", "#E0BBE4"]}
                                            textColors={["#333"]}
                                            outerBorderColor={"#aaa"}
                                            radiusLineColor={"#ddd"}
                                            fontSize={13}
                                            spinDuration={0.3}
                                        />
                                    </div>
                                ) : (
                                    <div style={{ height: 300 }} />
                                )}
                            </>
                        )}
                    </div>
                </div>
                </>
            )}
        </div>
    );
}

export default LineUpRandom;