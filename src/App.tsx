import { useEffect, useRef, useState, type CSSProperties } from 'react';

type Phase = 'idle' | 'maze' | 'search' | 'done';
type Algo = 'BFS' | 'DFS';
type MazeType = 'spiral' | 'random' | 'empty';
type Speed = 'Slow' | 'Medium' | 'Fast';
type CellPos = [number, number];

type Styles = {
    nav: CSSProperties;
    logo: CSSProperties;
    logoAccent: CSSProperties;
    logoSub: CSSProperties;
    dd: CSSProperties;
    ddBtn: (disabled: boolean) => CSSProperties;
    ddMenu: CSSProperties;
    ddItem: (active: boolean) => CSSProperties;
    badge: CSSProperties;
    pulse: CSSProperties;
    startBtn: (disabled: boolean) => CSSProperties;
    clearBtn: CSSProperties;
    legend: CSSProperties;
    swatch: (color: string) => CSSProperties;
    swatchLabel: CSSProperties;
    main: CSSProperties;
    grid: CSSProperties;
    toast: CSSProperties;
};

const ROWS = 31;
const COLS = 31;

const SPEEDS: Record<Speed, { maze: number; search: number }> = {
    Slow: { maze: 12, search: 60 },
    Medium: { maze: 4, search: 20 },
    Fast: { maze: 1, search: 3 },
};

function spiralWallOrder(): CellPos[] {
    const walls: CellPos[] = [];
    let top = 0,
        left = 0,
        bottom = ROWS - 1,
        right = COLS - 1,
        dir = 0;
    while (top <= bottom && left <= right) {
        if (dir === 0) {
            for (let c = left; c <= right; c++) walls.push([top, c]);
            top += 2;
        } else if (dir === 1) {
            for (let r = top; r <= bottom; r++) walls.push([r, right]);
            right -= 2;
        } else if (dir === 2) {
            for (let c = right; c >= left; c--) walls.push([bottom, c]);
            bottom -= 2;
        } else {
            for (let r = bottom; r >= top; r--) walls.push([r, left]);
            left += 2;
        }
        dir = (dir + 1) % 4;
    }
    const m = Math.floor(ROWS / 2);
    return walls.filter(([r, c]) => !(r === m && Math.abs(c - m) <= 1));
}

function randomWallOrder(
    sR: number,
    sC: number,
    tR: number,
    tC: number,
): CellPos[] {
    const walls: CellPos[] = [];
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
            if (
                !(r === sR && c === sC) &&
                !(r === tR && c === tC) &&
                Math.random() < 0.28
            )
                walls.push([r, c]);
    for (let i = walls.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [walls[i], walls[j]] = [walls[j], walls[i]];
    }
    return walls;
}

const nbrs = (r: number, c: number): CellPos[] => [
    [r - 1, c],
    [r + 1, c],
    [r, c - 1],
    [r, c + 1],
];

const START = { r: Math.floor(ROWS / 2), c: Math.floor(COLS / 2) - 6 };
const TGT = { r: Math.floor(ROWS / 2), c: Math.floor(COLS / 2) + 6 };

// Cell state: 0=unvisited 1=wall 2=visited 3=path 4=start 5=target
const CELL_COLORS: Record<number, string> = {
    0: '#f8fafc', // unvisited — clean white
    1: '#1e1b4b', // wall — deep indigo
    2: '#a78bfa', // visited — soft violet
    3: '#fbbf24', // path — vivid amber/yellow ★
    4: '#4ade80', // start — green
    5: '#f43f5e', // target — rose
};

export default function App() {
    // Flat Uint8Array for cell states — much faster than object grid for rendering
    const [cellStates, setCellStates] = useState(() => {
        const arr = new Uint8Array(ROWS * COLS);
        arr[START.r * COLS + START.c] = 4;
        arr[TGT.r * COLS + TGT.c] = 5;
        return arr;
    });

    const [phase, setPhase] = useState<Phase>('idle');
    const [algo, setAlgo] = useState<Algo>('BFS');
    const [mazeType, setMazeType] = useState<MazeType>('spiral');
    const [speed, setSpeed] = useState<Speed>('Medium');
    const [toast, setToast] = useState('');
    const [pathLen, setPathLen] = useState(0);
    const [algoOpen, setAlgoOpen] = useState(false);
    const [mazeOpen, setMazeOpen] = useState(false);
    const [speedOpen, setSpeedOpen] = useState(false);

    const timerRef = useRef<number | null>(null);
    const running = phase === 'maze' || phase === 'search';

    const clearTimer = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
    };

    useEffect(() => () => clearTimer(), []);
    useEffect(() => {
        const h = () => {
            setAlgoOpen(false);
            setMazeOpen(false);
            setSpeedOpen(false);
        };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, []);

    function freshStates() {
        const arr = new Uint8Array(ROWS * COLS);
        arr[START.r * COLS + START.c] = 4;
        arr[TGT.r * COLS + TGT.c] = 5;
        return arr;
    }

    function clearAll() {
        clearTimer();
        setPhase('idle');
        setCellStates(freshStates());
        setToast('');
        setPathLen(0);
    }

    function toggleCell(r: number, c: number) {
        if (running) return;
        if ((r === START.r && c === START.c) || (r === TGT.r && c === TGT.c))
            return;
        setCellStates((prev) => {
            const next = new Uint8Array(prev);
            const idx = r * COLS + c;
            next[idx] = next[idx] === 1 ? 0 : 1;
            return next;
        });
    }

    // ── START ──────────────────────────────────────────────────────────────
    function handleStart() {
        if (running) return;
        clearTimer();

        const ms = SPEEDS[speed];
        const wallGrid = Array.from({ length: ROWS }, () =>
            Array(COLS).fill(false),
        );

        if (mazeType === 'empty') {
            const base = freshStates();
            setCellStates(base);
            setPhase('search');
            setToast(`Running ${algo}…`);
            runSearch(wallGrid, base, ms.search);
            return;
        }

        // Phase 1: animate maze
        setPhase('maze');
        setToast('Generating maze…');
        const base = freshStates();
        setCellStates(base);

        const wallOrder: CellPos[] =
            mazeType === 'spiral'
                ? spiralWallOrder()
                : randomWallOrder(START.r, START.c, TGT.r, TGT.c);

        // Pre-compute final wall layout
        for (const [r, c] of wallOrder) wallGrid[r][c] = true;

        let i = 0;
        const working = new Uint8Array(base);

        function stepMaze() {
            const batch = ms.maze <= 1 ? 12 : 1;
            for (let b = 0; b < batch && i < wallOrder.length; b++, i++) {
                const [r, c] = wallOrder[i];
                working[r * COLS + c] = 1;
            }
            setCellStates(new Uint8Array(working));

            if (i < wallOrder.length) {
                timerRef.current = setTimeout(stepMaze, ms.maze);
            } else {
                setPhase('search');
                setToast(`Maze done! Running ${algo}…`);
                runSearch(wallGrid, working, ms.search);
            }
        }
        stepMaze();
    }

    // ── BFS / DFS search ──────────────────────────────────────────────────
    function runSearch(
        wallGrid: boolean[][],
        baseStates: Uint8Array,
        ms: number,
    ) {
        const seen = Array.from({ length: ROWS }, () => new Uint8Array(COLS));
        // prev stores flat index of parent (-1 = none)
        const prev = new Int32Array(ROWS * COLS).fill(-1);
        const visitOrder: CellPos[] = [];

        seen[START.r][START.c] = 1;

        if (algo === 'BFS') {
            // Standard BFS — guarantees shortest path
            const queue = [[START.r, START.c]];
            let head = 0;
            while (head < queue.length) {
                const [r, c] = queue[head++];
                visitOrder.push([r, c]);
                if (r === TGT.r && c === TGT.c) break;
                for (const [nr, nc] of nbrs(r, c)) {
                    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
                    if (seen[nr][nc] || wallGrid[nr][nc]) continue;
                    seen[nr][nc] = 1;
                    prev[nr * COLS + nc] = r * COLS + c;
                    queue.push([nr, nc]);
                }
            }
        } else {
            // DFS
            const stack: CellPos[] = [[START.r, START.c]];
            while (stack.length) {
                const item = stack.pop();
                if (!item) break;
                const [r, c] = item;
                if (seen[r][c]) continue;
                seen[r][c] = 1;
                visitOrder.push([r, c]);
                if (r === TGT.r && c === TGT.c) break;
                for (const [nr, nc] of nbrs(r, c)) {
                    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
                    if (seen[nr][nc] || wallGrid[nr][nc]) continue;
                    prev[nr * COLS + nc] = r * COLS + c;
                    stack.push([nr, nc]);
                }
            }
        }

        // Animate visited cells
        let i = 0;
        const working = new Uint8Array(baseStates);

        function stepVisit() {
            const batch = ms <= 3 ? 8 : 1;
            for (let b = 0; b < batch && i < visitOrder.length; b++, i++) {
                const [r, c] = visitOrder[i];
                const idx = r * COLS + c;
                if (working[idx] !== 4 && working[idx] !== 5) working[idx] = 2;
            }
            setCellStates(new Uint8Array(working));

            if (i < visitOrder.length) {
                timerRef.current = setTimeout(stepVisit, ms);
            } else {
                // Reconstruct shortest path
                const targetIdx = TGT.r * COLS + TGT.c;
                if (prev[targetIdx] === -1) {
                    setPhase('done');
                    setToast('No path found!');
                    return;
                }

                const path: number[] = [];
                let cur = targetIdx;
                while (cur !== -1) {
                    path.push(cur);
                    cur = prev[cur];
                }
                path.reverse();
                setPathLen(path.length);

                // Animate path in yellow
                let pi = 0;
                function stepPath() {
                    const batchP = ms <= 3 ? 4 : 1;
                    for (let b = 0; b < batchP && pi < path.length; b++, pi++) {
                        const idx = path[pi];
                        if (working[idx] !== 4 && working[idx] !== 5)
                            working[idx] = 3;
                    }
                    setCellStates(new Uint8Array(working));

                    if (pi < path.length) {
                        timerRef.current = setTimeout(stepPath, ms * 1.5);
                    } else {
                        setPhase('done');
                        setToast(`✓ Shortest path: ${path.length} steps`);
                    }
                }
                stepPath();
            }
        }
        stepVisit();
    }

    // ── Render grid via canvas-style inline styles ─────────────────────────
    const CELL_PX = 20;

    const rows = [];
    for (let r = 0; r < ROWS; r++) {
        const cells = [];
        for (let c = 0; c < COLS; c++) {
            const state = cellStates[r * COLS + c];
            cells.push(
                <div
                    key={c}
                    onClick={() => toggleCell(r, c)}
                    style={{
                        width: CELL_PX,
                        height: CELL_PX,
                        backgroundColor: CELL_COLORS[state],
                        borderRight: '1px solid #e2e8f0',
                        borderBottom: '1px solid #e2e8f0',
                        flexShrink: 0,
                        cursor: running ? 'default' : 'pointer',
                        transition: 'background-color 80ms ease',
                        boxSizing: 'border-box',
                    }}
                />,
            );
        }
        rows.push(
            <div key={r} style={{ display: 'flex' }}>
                {cells}
            </div>,
        );
    }

    const startLabel =
        phase === 'maze'
            ? 'Building…'
            : phase === 'search'
              ? 'Searching…'
              : phase === 'done'
                ? 'Run Again'
                : 'Start';

    const algoOptions: { id: Algo; label: string; desc: string }[] = [
        {
            id: 'BFS',
            label: 'BFS — Shortest path guaranteed',
            desc: 'Explores layer by layer',
        },
        {
            id: 'DFS',
            label: 'DFS — Explores deep first',
            desc: 'Not necessarily shortest',
        },
    ];
    const mazeOptions: { id: MazeType; label: string }[] = [
        { id: 'spiral', label: 'Simple Spiral' },
        { id: 'random', label: 'Random Walls' },
        { id: 'empty', label: 'Empty Grid' },
    ];
    const speedOptions: Speed[] = ['Slow', 'Medium', 'Fast'];

    const styles: Styles = {
        nav: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 20px',
            height: 52,
            background: '#0f0a1e',
            position: 'sticky',
            top: 0,
            zIndex: 10,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            fontFamily: 'ui-monospace, monospace',
        },
        logo: {
            fontWeight: 800,
            fontSize: 16,
            marginRight: 12,
            letterSpacing: '-0.02em',
        },
        logoAccent: { color: '#c084fc' },
        logoSub: { color: '#fff' },
        dd: { position: 'relative' },
        ddBtn: (disabled) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 12px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'transparent',
            color: disabled ? 'rgba(255,255,255,0.35)' : '#e2e8f0',
            fontSize: 12,
            fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontFamily: 'ui-monospace, monospace',
        }),
        ddMenu: {
            position: 'absolute',
            top: '100%',
            marginTop: 4,
            left: 0,
            zIndex: 50,
            minWidth: 200,
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.1)',
            background: '#1a0a2e',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            overflow: 'hidden',
        },
        ddItem: (active) => ({
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '9px 14px',
            border: 'none',
            background: active ? 'rgba(192,132,252,0.15)' : 'transparent',
            color: active ? '#c084fc' : '#cbd5e1',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'ui-monospace, monospace',
        }),
        badge: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginRight: 8,
        },
        pulse: {
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#c084fc',
            animation: 'pulse 1.4s ease-in-out infinite',
        },
        startBtn: (disabled) => ({
            padding: '6px 20px',
            borderRadius: 6,
            border: '2px solid #c084fc',
            background: 'transparent',
            color: '#c084fc',
            fontSize: 13,
            fontWeight: 700,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            minWidth: 120,
            textAlign: 'center',
            fontFamily: 'ui-monospace, monospace',
            transition: 'background 0.15s, color 0.15s',
        }),
        clearBtn: {
            padding: '6px 16px',
            borderRadius: 6,
            border: '2px solid rgba(255,255,255,0.3)',
            background: 'transparent',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'ui-monospace, monospace',
        },
        legend: {
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 20,
            padding: '10px 24px',
            background: '#fff',
            borderBottom: '1px solid #e2e8f0',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        },
        swatch: (color) => ({
            width: 16,
            height: 16,
            borderRadius: 3,
            background: color,
            flexShrink: 0,
            border: color === '#f8fafc' ? '1px solid #cbd5e1' : 'none',
        }),
        swatchLabel: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 500,
            color: '#475569',
        },
        main: {
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            padding: '24px 16px',
            background: '#f1f5f9',
            minHeight: 'calc(100vh - 100px)',
        },
        grid: {
            border: '1px solid #cbd5e1',
            background: '#f8fafc',
            display: 'inline-block',
            lineHeight: 0,
            boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        },
        toast: {
            position: 'fixed',
            bottom: 20,
            right: 20,
            background: '#0f0a1e',
            color: '#fff',
            borderRadius: 10,
            padding: '12px 16px',
            fontSize: 13,
            maxWidth: 220,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            border: '1px solid rgba(192,132,252,0.3)',
            fontFamily: 'ui-monospace, monospace',
            zIndex: 100,
        },
    };

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: '100vh',
                background: '#f1f5f9',
            }}
        >
            <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        button:hover { filter: brightness(1.1); }
      `}</style>

            {/* NAV */}
            <nav style={styles.nav}>
                <span style={styles.logo}>
                    <span style={styles.logoAccent}>Path</span>
                    <span style={styles.logoSub}>Finder</span>
                </span>

                {/* Algorithm */}
                <div style={styles.dd} onMouseDown={(e) => e.stopPropagation()}>
                    <button
                        disabled={running}
                        style={styles.ddBtn(running)}
                        onClick={() => {
                            setAlgoOpen((v) => !v);
                            setMazeOpen(false);
                            setSpeedOpen(false);
                        }}
                    >
                        {algo}{' '}
                        <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
                    </button>
                    {algoOpen && (
                        <div style={styles.ddMenu}>
                            {algoOptions.map((a) => (
                                <button
                                    key={a.id}
                                    style={styles.ddItem(algo === a.id)}
                                    onClick={() => {
                                        setAlgo(a.id);
                                        setAlgoOpen(false);
                                    }}
                                >
                                    {a.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Maze */}
                <div style={styles.dd} onMouseDown={(e) => e.stopPropagation()}>
                    <button
                        disabled={running}
                        style={styles.ddBtn(running)}
                        onClick={() => {
                            setMazeOpen((v) => !v);
                            setAlgoOpen(false);
                            setSpeedOpen(false);
                        }}
                    >
                        {mazeOptions.find((m) => m.id === mazeType)?.label}
                        <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
                    </button>
                    {mazeOpen && (
                        <div style={styles.ddMenu}>
                            {mazeOptions.map((m) => (
                                <button
                                    key={m.id}
                                    style={styles.ddItem(mazeType === m.id)}
                                    onClick={() => {
                                        setMazeType(m.id);
                                        setMazeOpen(false);
                                    }}
                                >
                                    {m.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Speed */}
                <div style={styles.dd} onMouseDown={(e) => e.stopPropagation()}>
                    <button
                        disabled={running}
                        style={styles.ddBtn(running)}
                        onClick={() => {
                            setSpeedOpen((v) => !v);
                            setAlgoOpen(false);
                            setMazeOpen(false);
                        }}
                    >
                        Speed: {speed}{' '}
                        <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
                    </button>
                    {speedOpen && (
                        <div style={styles.ddMenu}>
                            {speedOptions.map((s) => (
                                <button
                                    key={s}
                                    style={styles.ddItem(speed === s)}
                                    onClick={() => {
                                        setSpeed(s);
                                        setSpeedOpen(false);
                                    }}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div style={{ flex: 1 }} />

                {running && (
                    <div style={styles.badge}>
                        <div style={styles.pulse} />
                        <span
                            style={{
                                color: 'rgba(255,255,255,0.5)',
                                fontSize: 11,
                                fontWeight: 600,
                            }}
                        >
                            {phase === 'maze'
                                ? 'Building maze…'
                                : `${algo} running…`}
                        </span>
                    </div>
                )}

                <button
                    onClick={phase === 'done' ? clearAll : handleStart}
                    disabled={running}
                    style={styles.startBtn(running)}
                >
                    {startLabel}
                </button>
                <button onClick={clearAll} style={styles.clearBtn}>
                    Clear
                </button>
            </nav>

            {/* LEGEND */}
            <div style={styles.legend}>
                {[
                    ['#1e1b4b', 'Wall'],
                    ['#4ade80', 'Start'],
                    ['#f43f5e', 'Target'],
                    ['#a78bfa', 'Visited'],
                    ['#fbbf24', 'Shortest Path (BFS)'],
                    ['#f8fafc', 'Unvisited'],
                ].map(([color, label]) => (
                    <div key={label} style={styles.swatchLabel}>
                        <div style={styles.swatch(color)} />
                        {label}
                    </div>
                ))}
                {phase === 'done' && pathLen > 0 && (
                    <span
                        style={{
                            marginLeft: 'auto',
                            fontSize: 12,
                            fontWeight: 700,
                            color: '#c084fc',
                        }}
                    >
                        Path length: {pathLen} steps
                    </span>
                )}
            </div>

            {/* GRID */}
            <main style={styles.main}>
                <div style={styles.grid}>{rows}</div>
            </main>

            {/* TOAST */}
            {toast && (
                <div style={styles.toast}>
                    <div
                        style={{
                            color: '#c084fc',
                            fontWeight: 700,
                            fontSize: 15,
                            marginBottom: 4,
                        }}
                    >
                        {phase === 'done' && pathLen > 0
                            ? '✓'
                            : phase === 'done'
                              ? '✗'
                              : '◉'}
                    </div>
                    <div>{toast}</div>
                </div>
            )}
        </div>
    );
}
