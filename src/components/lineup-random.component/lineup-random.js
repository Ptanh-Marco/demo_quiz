import React, { useState, useRef, useEffect } from "react";
import Papa from "papaparse";
import { Wheel } from "react-custom-roulette";

// Settings
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRpwiRyswcJ8kBnT_EzvQgqqrFJt9u7KGrZR64CgSBfdSCwPwMrjl6xIBbZdnYWIRrwb686s5qbtJDJ/pub?gid=0&single=true&output=csv";
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

    // Fetch players from Google Sheet
    async function fetchPlayersFromSheet() {
        const response = await fetch(CSV_URL);
        const csv = await response.text();

        let csvLines = csv.split('\n');
        if (csvLines.length <= 3) {
            return []; // Not enough data
        }

        // Remove first 3 rows, filter out empty lines
        csvLines = csvLines.slice(3).filter(line => line.trim() !== "");
        if (csvLines.length === 0) {
            return []; // No data after skipping
        }

        const cleanedCsv = csvLines.join('\n');
        const { data } = Papa.parse(cleanedCsv, {
            header: true,
            skipEmptyLines: true
        });

        // Defensive filtering: check if "Danh sách" and "Tier" exist and are non-empty
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
        const fullRounds = Math.floor(tierPlayers.length / TEAM_COUNT) * TEAM_COUNT;
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
        const fullRounds = Math.floor(tierPlayers.length / TEAM_COUNT) * TEAM_COUNT;

        if (div3Tiers.includes(tier)) {
            // Divisible by 3: just advance or finish
            if (available.length > 0) {
                setRoundPlayers([...available]);
                setTeamInRound(0);
                setTimeout(() => setMustSpin(true), 350);
            } else {
                setTimeout(() => advanceTier(), 700);
            }
            return;
        }

        // Not divisible by 3
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

    // Wheel data
    let wheelData = [];
    let assignMode = null;
    if (roundPlayers.length > 0 && teamInRound < TEAM_COUNT) {
        wheelData = roundPlayers.map((p) => ({ option: p.name }));
        assignMode = "round";
    } else if (remainderPlayers.length > 0 && remainderIdx < remainderPlayers.length) {
        const minSize = Math.min(...teams.map(team => team.length));
        const eligibleTeams = teams
            .map((team, idx) => (team.length === minSize ? idx : null))
            .filter((idx) => idx !== null);
        wheelData = eligibleTeams.map((idx) => ({ option: `Team ${idx + 1}` }));
        assignMode = "remainder";
    }

    // Handle wheel stop
    function handleWheelStop() {
        if (assignMode === "round") {
            const player = roundPlayers[prizeNumber];
            const teamIdx = teamInRound;
            assignedNamesRef.current.add(player.name);
            setTeams(prevTeams =>
                prevTeams.map((team, idx) =>
                    idx === teamIdx ? [...team, player] : team
                )
            );
            setMustSpin(false);
            const nextPlayers = roundPlayers.filter((p, idx) => idx !== prizeNumber);
            if (teamInRound + 1 < TEAM_COUNT) {
                setRoundPlayers(nextPlayers);
                setTeamInRound(teamInRound + 1);
                setTimeout(() => setMustSpin(true), 350);
            } else {
                setRoundPlayers([]);
                setTeamInRound(0);
                setTimeout(startNextRound, 350);
            }
        } else if (assignMode === "remainder") {
            const minSize = Math.min(...teams.map(team => team.length));
            const eligibleTeams = teams
                .map((team, idx) => (team.length === minSize ? idx : null))
                .filter((idx) => idx !== null);
            const teamIdx = eligibleTeams[prizeNumber];
            const player = remainderPlayers[remainderIdx];
            assignedNamesRef.current.add(player.name);
            setTeams(prevTeams =>
                prevTeams.map((team, idx) =>
                    idx === teamIdx ? [...team, player] : team
                )
            );
            setMustSpin(false);
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
            setPrizeNumber(Math.floor(Math.random() * roundPlayers.length));
            setTimeout(() => setMustSpin(true), 350);
        }
        if (assignMode === "remainder") {
            if (remainderPlayers.length === 0 || remainderIdx >= remainderPlayers.length) return;
            if (wheelData.length === 0) return;
            setPrizeNumber(Math.floor(Math.random() * wheelData.length));
            setTimeout(() => setMustSpin(true), 350);
        }
        // eslint-disable-next-line
    }, [roundPlayers, teamInRound, assignMode, remainderPlayers.length, remainderIdx, wheelData.length, hasStarted]);

    // Detect assignment complete
    const allAssigned = isSynced && hasStarted && (
        currentTierIdx >= sortedTiers.length
    );

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
            )}
        </div>
    );
}

export default LineUpRandom;