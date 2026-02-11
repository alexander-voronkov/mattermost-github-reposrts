import React, { useState, useEffect, useCallback } from 'react';
import './styles.css';

interface GitHubUser {
    login: string;
    avatar_url: string;
    name?: string;
}

interface ContributorCommit {
    sha: string;
    message: string;
    date: string;
}

interface ContributorWithCommits {
    login: string;
    avatar_url: string;
    repos: Record<string, ContributorCommit[]>;
}

interface MMUser {
    id: string;
    username: string;
    first_name: string;
    last_name: string;
    nickname: string;
    email: string;
    is_bot?: boolean;
    delete_at?: number;
}

interface UserMappingsProps {
    id: string;
    label: string;
    helpText: string;
    value: string;
    onChange: (id: string, value: string) => void;
    setSaveNeeded: () => void;
}

const PLUGIN_ID = 'com.fambear.github-reports';

export const UserMappingsComponent: React.FC<UserMappingsProps> = ({
    id,
    label,
    helpText,
    value,
    onChange,
    setSaveNeeded,
}) => {
    const [mappings, setMappings] = useState<Record<string, string>>({});
    const [githubUsers, setGithubUsers] = useState<GitHubUser[]>([]);
    const [mmUsers, setMmUsers] = useState<MMUser[]>([]);
    const [contributors, setContributors] = useState<ContributorWithCommits[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingContribs, setLoadingContribs] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchGH, setSearchGH] = useState('');
    const [searchMM, setSearchMM] = useState('');
    const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
    const mmInputRef = React.useRef<HTMLInputElement>(null);

    // Parse initial value
    useEffect(() => {
        try {
            const parsed = value ? JSON.parse(value) : {};
            setMappings(parsed);
        } catch {
            setMappings({});
        }
    }, []);

    // Fetch GitHub contributors and MM users
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [ghRes, mmRes] = await Promise.all([
                    fetch(`/plugins/${PLUGIN_ID}/api/v1/github/all-contributors`),
                    fetch(`/plugins/${PLUGIN_ID}/api/v1/mattermost/users`),
                ]);

                if (ghRes.ok) {
                    const ghData = await ghRes.json();
                    setGithubUsers(Array.isArray(ghData) ? ghData : []);
                }

                if (mmRes.ok) {
                    const mmData = await mmRes.json();
                    setMmUsers(mmData);
                }
            } catch (err) {
                setError('Failed to load users');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    // Fetch contributors with commits (for reference table)
    useEffect(() => {
        const fetchContribs = async () => {
            setLoadingContribs(true);
            try {
                const res = await fetch(`/plugins/${PLUGIN_ID}/api/v1/github/contributors-with-commits`);
                if (res.ok) {
                    const data = await res.json();
                    setContributors(Array.isArray(data) ? data : []);
                }
            } catch (err) {
                // Silently fail - this is just reference data
            } finally {
                setLoadingContribs(false);
            }
        };

        fetchContribs();
    }, []);

    // Update parent when mappings change
    const updateMappings = useCallback((newMappings: Record<string, string>) => {
        setMappings(newMappings);
        onChange(id, JSON.stringify(newMappings));
        setSaveNeeded();
    }, [id, onChange, setSaveNeeded]);

    const addMapping = (ghLogin: string, mmId: string) => {
        const newMappings = { ...mappings, [ghLogin]: mmId };
        updateMappings(newMappings);
        setActiveDropdown(null);
        setSearchGH('');
        setSearchMM('');
    };

    const removeMapping = (ghLogin: string) => {
        const newMappings = { ...mappings };
        delete newMappings[ghLogin];
        updateMappings(newMappings);
    };

    const filteredGHUsers = githubUsers
        .filter(u => !mappings[u.login])
        .filter(u => u.login.toLowerCase().includes(searchGH.toLowerCase()));

    const filteredMMUsers = mmUsers
        .filter(u => {
            const displayName = `${u.first_name} ${u.last_name} ${u.username} ${u.nickname}`.toLowerCase();
            return displayName.includes(searchMM.toLowerCase());
        });

    const getMMUser = (mmId: string) => mmUsers.find(u => u.id === mmId);
    const getGHUser = (login: string) => githubUsers.find(u => u.login === login);

    const getMMDisplayName = (user: MMUser) => {
        let name = '';
        if (user.first_name || user.last_name) {
            name = `${user.first_name} ${user.last_name}`.trim();
        } else {
            name = user.nickname || user.username;
        }
        return name;
    };

    const getMMUserBadge = (user: MMUser) => {
        if (user.is_bot) return '🤖';
        if (user.delete_at && user.delete_at > 0) return '👻';
        return null;
    };

    const selectContributor = (login: string) => {
        setSearchGH(login);
        setActiveDropdown('mm');
        setSearchMM('');
        // Focus MM input
        setTimeout(() => {
            mmInputRef.current?.focus();
        }, 50);
    };

    // Check if contributor is already mapped
    const isMapped = (login: string) => !!mappings[login];

    if (loading) {
        return <div className="user-mappings-loading">Loading users...</div>;
    }

    return (
        <div className="user-mappings-container">
            <label className="user-mappings-label">{label}</label>
            <p className="user-mappings-help">{helpText}</p>

            {error && <div className="user-mappings-error">{error}</div>}

            {/* Existing mappings */}
            <div className="user-mappings-list">
                {Object.entries(mappings).map(([ghLogin, mmId]) => {
                    const ghUser = getGHUser(ghLogin);
                    const mmUser = getMMUser(mmId);
                    return (
                        <div key={ghLogin} className="user-mapping-row">
                            <div className="user-mapping-gh">
                                {ghUser?.avatar_url && (
                                    <img src={ghUser.avatar_url} alt="" className="user-avatar-small" />
                                )}
                                <span className="user-login">@{ghLogin}</span>
                            </div>
                            <span className="mapping-arrow">→</span>
                            <div className="user-mapping-mm">
                                <img 
                                    src={`/api/v4/users/${mmId}/image?_=0`} 
                                    alt="" 
                                    className="user-avatar-small" 
                                />
                                <span className="user-name">
                                    {mmUser && getMMUserBadge(mmUser)} {mmUser ? getMMDisplayName(mmUser) : mmId}
                                </span>
                                <span className="user-username">@{mmUser?.username}</span>
                            </div>
                            <button 
                                type="button"
                                className="mapping-remove-btn"
                                onClick={() => removeMapping(ghLogin)}
                            >
                                ×
                            </button>
                        </div>
                    );
                })}
            </div>

            {/* Add new mapping */}
            <div className="user-mapping-add">
                <div className="mapping-dropdown-container">
                    <div className="mapping-dropdown">
                        <input
                            type="text"
                            placeholder="GitHub username..."
                            value={searchGH}
                            onChange={(e) => {
                                setSearchGH(e.target.value);
                                setActiveDropdown('gh');
                            }}
                            onFocus={() => setActiveDropdown('gh')}
                            onKeyDown={(e) => {
                                if (e.key === 'Tab' && searchGH.trim()) {
                                    setActiveDropdown('mm');
                                }
                            }}
                        />
                        {activeDropdown === 'gh' && searchGH && (
                            <div className="dropdown-list">
                                {/* Option to use the typed value directly */}
                                {searchGH.trim() && !filteredGHUsers.some(u => u.login.toLowerCase() === searchGH.toLowerCase()) && (
                                    <div
                                        className="dropdown-item dropdown-item-custom"
                                        onClick={() => {
                                            setActiveDropdown('mm');
                                        }}
                                    >
                                        <span className="custom-entry-icon">✏️</span>
                                        <span>Use "{searchGH}"</span>
                                    </div>
                                )}
                                {filteredGHUsers.slice(0, 10).map(user => (
                                    <div
                                        key={user.login}
                                        className="dropdown-item"
                                        onClick={() => {
                                            setSearchGH(user.login);
                                            setActiveDropdown('mm');
                                        }}
                                    >
                                        {user.avatar_url && (
                                            <img src={user.avatar_url} alt="" className="user-avatar-tiny" />
                                        )}
                                        <span>@{user.login}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <span className="mapping-arrow">→</span>

                    <div className="mapping-dropdown">
                        <input
                            ref={mmInputRef}
                            type="text"
                            placeholder="Search Mattermost user..."
                            value={searchMM}
                            onChange={(e) => {
                                setSearchMM(e.target.value);
                                setActiveDropdown('mm');
                            }}
                            onFocus={() => setActiveDropdown('mm')}
                        />
                        {activeDropdown === 'mm' && filteredMMUsers.length > 0 && searchGH && (
                            <div className="dropdown-list">
                                {filteredMMUsers.slice(0, 15).map(user => (
                                    <div
                                        key={user.id}
                                        className={`dropdown-item ${user.delete_at ? 'inactive' : ''} ${user.is_bot ? 'bot' : ''}`}
                                        onClick={() => {
                                            addMapping(searchGH, user.id);
                                        }}
                                    >
                                        <img 
                                            src={`/api/v4/users/${user.id}/image?_=0`} 
                                            alt="" 
                                            className="user-avatar-tiny" 
                                        />
                                        <span className="dropdown-user-name">
                                            {getMMUserBadge(user)} {getMMDisplayName(user)}
                                        </span>
                                        <span className="dropdown-user-username">@{user.username}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Contributors reference table */}
            {!loadingContribs && contributors.length > 0 && (
                <div className="contributors-reference">
                    <h4 className="contributors-title">GitHub Contributors Reference</h4>
                    <p className="contributors-hint">Click on a username to add mapping</p>
                    <table className="contributors-table">
                        <thead>
                            <tr>
                                <th>GitHub User</th>
                                <th>Repositories & Recent Commits</th>
                            </tr>
                        </thead>
                        <tbody>
                            {contributors
                                .filter(c => Object.keys(c.repos).length > 0)
                                .map(contrib => (
                                <tr key={contrib.login} className={isMapped(contrib.login) ? 'mapped' : ''}>
                                    <td className="contrib-user-cell">
                                        <button
                                            type="button"
                                            className="contrib-user-btn"
                                            onClick={() => selectContributor(contrib.login)}
                                            disabled={isMapped(contrib.login)}
                                        >
                                            {contrib.avatar_url && (
                                                <img src={contrib.avatar_url} alt="" className="contrib-avatar" />
                                            )}
                                            <span className="contrib-login">@{contrib.login}</span>
                                            {isMapped(contrib.login) && <span className="mapped-badge">✓</span>}
                                        </button>
                                    </td>
                                    <td className="contrib-repos-cell">
                                        {Object.entries(contrib.repos).map(([repoName, commits]) => (
                                            <div key={repoName} className="contrib-repo">
                                                <span className="repo-name-badge">{repoName}</span>
                                                <div className="repo-commits">
                                                    {commits.map(commit => (
                                                        <div key={commit.sha} className="commit-line">
                                                            <span className="commit-date">{commit.date}</span>
                                                            <span className="commit-sha">{commit.sha}</span>
                                                            <span className="commit-msg">{commit.message}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {loadingContribs && (
                <p className="user-mappings-loading">Loading contributors...</p>
            )}
        </div>
    );
};

export default UserMappingsComponent;
