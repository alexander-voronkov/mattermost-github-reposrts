import React, {useState, useEffect, useCallback} from 'react';
import './styles.css';

// Sample data structure - will be replaced with API calls
const sampleData: Record<string, UserData> = {
    "alfred361@gmail.com": {
        name: "Alexander V.",
        total: {commits: 494, added: 33837, removed: 13099},
        weekly: {
            "2026-W01": {commits: 6, added: 279, removed: 102},
            "2026-W02": {commits: 14, added: 2855, removed: 97},
            "2026-W03": {commits: 1, added: 6, removed: 6},
            "2026-W04": {commits: 68, added: 8640, removed: 2035},
            "2026-W05": {commits: 71, added: 4745, removed: 3293},
            "2026-W06": {commits: 21, added: 23, removed: 23},
            "2026-W07": {commits: 20, added: 3837, removed: 253},
        }
    },
    "alexey.sogoyan": {
        name: "Alexey Sogoyan",
        total: {commits: 562, added: 94386, removed: 15252},
        weekly: {
            "2026-W02": {commits: 17, added: 869, removed: 253},
            "2026-W03": {commits: 8, added: 325, removed: 32},
            "2026-W04": {commits: 14, added: 491, removed: 109},
            "2026-W05": {commits: 13, added: 516, removed: 422},
            "2026-W06": {commits: 24, added: 1021, removed: 186},
            "2026-W07": {commits: 6, added: 195, removed: 48},
        }
    },
    "vgzulus@gmail.com": {
        name: "Vlad G.",
        total: {commits: 284, added: 128341, removed: 18936},
        weekly: {
            "2026-W01": {commits: 8, added: 218, removed: 49},
            "2026-W02": {commits: 11, added: 316, removed: 71},
            "2026-W03": {commits: 6, added: 209, removed: 70},
            "2026-W04": {commits: 10, added: 1140, removed: 303},
            "2026-W05": {commits: 19, added: 6168, removed: 1392},
            "2026-W06": {commits: 17, added: 1101, removed: 208},
            "2026-W07": {commits: 10, added: 449, removed: 47},
        }
    },
};

interface WeeklyStats {
    commits: number;
    added: number;
    removed: number;
}

interface UserData {
    name: string;
    total: {commits: number; added: number; removed: number};
    weekly: Record<string, WeeklyStats>;
}

interface DateRange {
    start: string;
    end: string;
}

const GitHubReportsRHS: React.FC = () => {
    const [users, setUsers] = useState<string[]>(Object.keys(sampleData));
    const [selectedUsers, setSelectedUsers] = useState<string[]>(Object.keys(sampleData));
    const [dateRange, setDateRange] = useState<DateRange>({start: '2026-W01', end: '2026-W07'});
    const [data, setData] = useState<Record<string, UserData>>(sampleData);

    const toggleUser = (email: string) => {
        setSelectedUsers(prev => 
            prev.includes(email) 
                ? prev.filter(u => u !== email)
                : [...prev, email]
        );
    };

    const getFilteredStats = useCallback(() => {
        const result: Record<string, {name: string; commits: number; added: number; removed: number}> = {};
        
        for (const email of selectedUsers) {
            const userData = data[email];
            if (!userData) continue;
            
            let commits = 0, added = 0, removed = 0;
            
            for (const [week, stats] of Object.entries(userData.weekly)) {
                if (week >= dateRange.start && week <= dateRange.end) {
                    commits += stats.commits;
                    added += stats.added;
                    removed += stats.removed;
                }
            }
            
            result[email] = {name: userData.name, commits, added, removed};
        }
        
        return result;
    }, [selectedUsers, dateRange, data]);

    const filteredStats = getFilteredStats();
    const totalCommits = Object.values(filteredStats).reduce((s, u) => s + u.commits, 0);
    const totalAdded = Object.values(filteredStats).reduce((s, u) => s + u.added, 0);
    const totalRemoved = Object.values(filteredStats).reduce((s, u) => s + u.removed, 0);

    return (
        <div className="github-reports-rhs">
            <div className="rhs-header">
                <h3>📊 GitHub Activity</h3>
                <span className="date-range">{dateRange.start} → {dateRange.end}</span>
            </div>

            <div className="filters-section">
                <div className="filter-group">
                    <label>Team Members</label>
                    <div className="user-pills">
                        {users.map(email => (
                            <button
                                key={email}
                                className={`user-pill ${selectedUsers.includes(email) ? 'active' : ''}`}
                                onClick={() => toggleUser(email)}
                            >
                                {data[email]?.name || email}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="filter-group">
                    <label>Date Range</label>
                    <div className="date-inputs">
                        <input
                            type="text"
                            placeholder="2026-W01"
                            value={dateRange.start}
                            onChange={(e) => setDateRange(prev => ({...prev, start: e.target.value}))}
                        />
                        <span>→</span>
                        <input
                            type="text"
                            placeholder="2026-W07"
                            value={dateRange.end}
                            onChange={(e) => setDateRange(prev => ({...prev, end: e.target.value}))}
                        />
                    </div>
                </div>
            </div>

            <div className="stats-overview">
                <div className="stat-card">
                    <div className="stat-value">{totalCommits.toLocaleString()}</div>
                    <div className="stat-label">Commits</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value green">+{totalAdded.toLocaleString()}</div>
                    <div className="stat-label">Added</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value red">-{totalRemoved.toLocaleString()}</div>
                    <div className="stat-label">Removed</div>
                </div>
            </div>

            <div className="user-breakdown">
                <h4>By Team Member</h4>
                {Object.entries(filteredStats)
                    .sort((a, b) => b[1].commits - a[1].commits)
                    .map(([email, stats]) => (
                        <div key={email} className="user-row">
                            <div className="user-info">
                                <span className="user-name">{stats.name}</span>
                                <span className="user-commits">{stats.commits} commits</span>
                            </div>
                            <div className="user-lines">
                                <span className="added">+{stats.added.toLocaleString()}</span>
                                <span className="removed">-{stats.removed.toLocaleString()}</span>
                            </div>
                            <div className="commit-bar">
                                <div 
                                    className="bar-fill"
                                    style={{width: `${(stats.commits / Math.max(...Object.values(filteredStats).map(s => s.commits))) * 100}%`}}
                                />
                            </div>
                        </div>
                    ))}
            </div>

            <div className="rhs-footer">
                <span>Last updated: {new Date().toLocaleDateString()}</span>
            </div>
        </div>
    );
};

export default GitHubReportsRHS;
