import React, {useState, useEffect, useCallback} from 'react';
import './styles.css';

const PLUGIN_ID = 'com.fambear.github-reports';

interface UserStats {
    mm_user_id: string;
    mm_username: string;
    name: string;
    commits: number;
    added: number;
    removed: number;
    by_repo: Record<string, number>;
}

interface StatsResponse {
    users: UserStats[];
    repos: string[];
    week_start: string;
    week_end: string;
    last_updated: string;
}

// Get current ISO week
const getCurrentWeek = (): string => {
    const now = new Date();
    const oneJan = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now.getTime() - oneJan.getTime()) / 86400000);
    const week = Math.ceil((days + oneJan.getDay() + 1) / 7);
    return `${now.getFullYear()}-W${week.toString().padStart(2, '0')}`;
};

// Get week from N weeks ago
const getWeekAgo = (weeksAgo: number): string => {
    const now = new Date();
    now.setDate(now.getDate() - weeksAgo * 7);
    const oneJan = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now.getTime() - oneJan.getTime()) / 86400000);
    const week = Math.ceil((days + oneJan.getDay() + 1) / 7);
    return `${now.getFullYear()}-W${week.toString().padStart(2, '0')}`;
};

// Parse ISO week to Date
const weekToDate = (isoWeek: string): Date => {
    const [year, weekStr] = isoWeek.split('-W');
    const week = parseInt(weekStr, 10);
    const simple = new Date(parseInt(year, 10), 0, 1 + (week - 1) * 7);
    const dow = simple.getDay();
    const isoWeekStart = simple;
    if (dow <= 4) {
        isoWeekStart.setDate(simple.getDate() - simple.getDay() + 1);
    } else {
        isoWeekStart.setDate(simple.getDate() + 8 - simple.getDay());
    }
    return isoWeekStart;
};

// Format date for display
const formatWeekRange = (isoWeek: string): string => {
    const start = weekToDate(isoWeek);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`;
};

const GitHubReportsRHS: React.FC = () => {
    const [weekStart, setWeekStart] = useState(getWeekAgo(4));
    const [weekEnd, setWeekEnd] = useState(getCurrentWeek());
    const [showFilters, setShowFilters] = useState(false);
    const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
    const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
    const [stats, setStats] = useState<StatsResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch stats from API
    const fetchStats = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const url = `/plugins/${PLUGIN_ID}/api/v1/stats?week_start=${weekStart}&week_end=${weekEnd}`;
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error('Failed to fetch stats');
            }
            const data: StatsResponse = await res.json();
            setStats(data);
            
            // Initialize selected users and repos if empty
            if (selectedUsers.size === 0 && data.users) {
                setSelectedUsers(new Set(data.users.map(u => u.mm_user_id || u.name)));
            }
            if (selectedRepos.size === 0 && data.repos) {
                setSelectedRepos(new Set(data.repos));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [weekStart, weekEnd]);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    // Toggle user selection
    const toggleUser = (userId: string) => {
        setSelectedUsers(prev => {
            const next = new Set(prev);
            if (next.has(userId)) {
                next.delete(userId);
            } else {
                next.add(userId);
            }
            return next;
        });
    };

    // Toggle repo selection
    const toggleRepo = (repo: string) => {
        setSelectedRepos(prev => {
            const next = new Set(prev);
            if (next.has(repo)) {
                next.delete(repo);
            } else {
                next.add(repo);
            }
            return next;
        });
    };

    // Filter stats based on selections
    const filteredUsers = stats?.users.filter(u => {
        const userId = u.mm_user_id || u.name;
        if (!selectedUsers.has(userId)) return false;
        
        // Check if user has commits in selected repos
        if (selectedRepos.size > 0 && u.by_repo) {
            const hasRepoCommits = Object.keys(u.by_repo).some(r => selectedRepos.has(r));
            if (!hasRepoCommits) return false;
        }
        return true;
    }) || [];

    // Calculate totals
    const totalCommits = filteredUsers.reduce((s, u) => s + u.commits, 0);
    const totalAdded = filteredUsers.reduce((s, u) => s + u.added, 0);
    const totalRemoved = filteredUsers.reduce((s, u) => s + u.removed, 0);

    return (
        <div className="github-reports-rhs">
            {/* Date Range - Single Row */}
            <div className="date-range-row">
                <label>Date range</label>
                <div className="date-inputs">
                    <input
                        type="week"
                        value={weekStart}
                        onChange={(e) => setWeekStart(e.target.value)}
                        className="week-input"
                    />
                    <span className="date-separator">→</span>
                    <input
                        type="week"
                        value={weekEnd}
                        onChange={(e) => setWeekEnd(e.target.value)}
                        className="week-input"
                    />
                </div>
            </div>

            {/* Expandable Filters Divider */}
            <button 
                className="filters-divider"
                onClick={() => setShowFilters(!showFilters)}
            >
                <span className="divider-line"></span>
                <span className="divider-text">
                    {showFilters ? '▲ Hide filters' : '▼ Show more filters'}
                </span>
                <span className="divider-line"></span>
            </button>

            {/* Additional Filters */}
            {showFilters && (
                <div className="additional-filters">
                    {/* Team Members Filter */}
                    <div className="filter-group">
                        <label>Team Members</label>
                        <div className="filter-chips">
                            {stats?.users.map(user => {
                                const userId = user.mm_user_id || user.name;
                                const isSelected = selectedUsers.has(userId);
                                return (
                                    <button
                                        key={userId}
                                        className={`filter-chip ${isSelected ? 'active' : ''}`}
                                        onClick={() => toggleUser(userId)}
                                    >
                                        {user.mm_username ? `@${user.mm_username}` : user.name}
                                        <span className="chip-count">{user.commits}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Repositories Filter */}
                    <div className="filter-group">
                        <label>Repositories</label>
                        <div className="filter-chips">
                            {stats?.repos.map(repo => {
                                const isSelected = selectedRepos.has(repo);
                                return (
                                    <button
                                        key={repo}
                                        className={`filter-chip repo ${isSelected ? 'active' : ''}`}
                                        onClick={() => toggleRepo(repo)}
                                    >
                                        {repo}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* Loading / Error */}
            {loading && <div className="loading-indicator">Loading...</div>}
            {error && <div className="error-message">{error}</div>}

            {/* Stats Overview */}
            {!loading && stats && (
                <>
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

                    {/* User Breakdown */}
                    <div className="user-breakdown">
                        <h4>By Team Member</h4>
                        {filteredUsers
                            .sort((a, b) => b.commits - a.commits)
                            .map(user => {
                                const maxCommits = Math.max(...filteredUsers.map(u => u.commits));
                                return (
                                    <div key={user.mm_user_id || user.name} className="user-row">
                                        <div className="user-info">
                                            <span className="user-name">
                                                {user.mm_username ? `@${user.mm_username}` : user.name}
                                            </span>
                                            <span className="user-commits">{user.commits} commits</span>
                                        </div>
                                        <div className="user-lines">
                                            <span className="added">+{user.added.toLocaleString()}</span>
                                            <span className="removed">-{user.removed.toLocaleString()}</span>
                                        </div>
                                        <div className="commit-bar">
                                            <div 
                                                className="bar-fill"
                                                style={{width: `${(user.commits / maxCommits) * 100}%`}}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                    </div>

                    <div className="rhs-footer">
                        <span>Last updated: {new Date(stats.last_updated).toLocaleString()}</span>
                        <button className="refresh-btn" onClick={fetchStats}>↻</button>
                    </div>
                </>
            )}
        </div>
    );
};

export default GitHubReportsRHS;
