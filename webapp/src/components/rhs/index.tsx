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

// Get ISO week number from date
const getISOWeek = (date: Date): { year: number; week: number } => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week };
};

// Format as ISO week string
const formatISOWeek = (year: number, week: number): string => {
    return `${year}-W${week.toString().padStart(2, '0')}`;
};

// Get current ISO week
const getCurrentWeek = (): string => {
    const { year, week } = getISOWeek(new Date());
    return formatISOWeek(year, week);
};

// Get week from N weeks ago
const getWeekAgo = (weeksAgo: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - weeksAgo * 7);
    const { year, week } = getISOWeek(d);
    return formatISOWeek(year, week);
};

// Parse ISO week to Monday of that week
const weekToDate = (isoWeek: string): Date => {
    const match = isoWeek.match(/(\d{4})-W(\d{2})/);
    if (!match) return new Date();
    const year = parseInt(match[1], 10);
    const week = parseInt(match[2], 10);
    
    // Find Jan 4 of the year (always in week 1)
    const jan4 = new Date(year, 0, 4);
    // Find Monday of week 1
    const dayOfWeek = jan4.getDay() || 7;
    const week1Monday = new Date(jan4);
    week1Monday.setDate(jan4.getDate() - dayOfWeek + 1);
    // Add weeks
    const result = new Date(week1Monday);
    result.setDate(week1Monday.getDate() + (week - 1) * 7);
    return result;
};

// Get all weeks for a month (for calendar)
const getWeeksInMonth = (year: number, month: number): { week: string; days: Date[] }[] => {
    const weeks: { week: string; days: Date[] }[] = [];
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    // Find Monday of the week containing first day
    let current = new Date(firstDay);
    const dow = current.getDay() || 7;
    current.setDate(current.getDate() - dow + 1);
    
    while (current <= lastDay || current.getMonth() === month) {
        const days: Date[] = [];
        const weekStart = new Date(current);
        for (let i = 0; i < 7; i++) {
            days.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }
        const { year: wy, week: wn } = getISOWeek(weekStart);
        weeks.push({ week: formatISOWeek(wy, wn), days });
        
        if (current.getMonth() > month && current.getDate() > 7) break;
        if (weeks.length > 6) break;
    }
    return weeks;
};

// Week Picker Component
interface WeekPickerProps {
    value: string;
    onChange: (week: string) => void;
}

const WeekPicker: React.FC<WeekPickerProps> = ({ value, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [viewDate, setViewDate] = useState(() => {
        const d = weekToDate(value);
        return { year: d.getFullYear(), month: d.getMonth() };
    });

    const weeks = getWeeksInMonth(viewDate.year, viewDate.month);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const prevMonth = () => {
        setViewDate(prev => {
            const m = prev.month - 1;
            return m < 0 ? { year: prev.year - 1, month: 11 } : { year: prev.year, month: m };
        });
    };

    const nextMonth = () => {
        setViewDate(prev => {
            const m = prev.month + 1;
            return m > 11 ? { year: prev.year + 1, month: 0 } : { year: prev.year, month: m };
        });
    };

    const selectWeek = (week: string) => {
        onChange(week);
        setIsOpen(false);
    };

    return (
        <div className="week-picker-container">
            <button className="week-picker-btn" onClick={() => setIsOpen(!isOpen)}>
                {value}
            </button>
            {isOpen && (
                <div className="week-picker-dropdown">
                    <div className="week-picker-header">
                        <button onClick={prevMonth}>◀</button>
                        <span>{monthNames[viewDate.month]} {viewDate.year}</span>
                        <button onClick={nextMonth}>▶</button>
                    </div>
                    <div className="week-picker-days-header">
                        <span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span>
                    </div>
                    <div className="week-picker-weeks">
                        {weeks.map(({ week, days }) => (
                            <div 
                                key={week}
                                className={`week-row ${week === value ? 'selected' : ''}`}
                                onClick={() => selectWeek(week)}
                            >
                                {days.map((day, i) => (
                                    <span 
                                        key={i} 
                                        className={`day ${day.getMonth() !== viewDate.month ? 'other-month' : ''}`}
                                    >
                                        {day.getDate()}
                                    </span>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
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
                    <WeekPicker value={weekStart} onChange={setWeekStart} />
                    <span className="date-separator">→</span>
                    <WeekPicker value={weekEnd} onChange={setWeekEnd} />
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
