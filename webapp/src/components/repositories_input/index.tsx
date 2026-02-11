import React, { useState, useEffect, useCallback } from 'react';
import './styles.css';

interface RepoStatus {
    name: string;
    status: 'validating' | 'valid' | 'private' | 'error';
    message?: string;
}

interface RepositoriesInputProps {
    id: string;
    label: string;
    helpText: string;
    value: string;
    onChange: (id: string, value: string) => void;
    setSaveNeeded: () => void;
}

const PLUGIN_ID = 'com.fambear.github-reports';

export const RepositoriesInput: React.FC<RepositoriesInputProps> = ({
    id,
    label,
    helpText,
    value,
    onChange,
    setSaveNeeded,
}) => {
    const [repos, setRepos] = useState<RepoStatus[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isValidating, setIsValidating] = useState(false);

    // Parse initial value
    useEffect(() => {
        if (value) {
            const repoNames = value.split(',').map(r => r.trim()).filter(Boolean);
            const initialRepos = repoNames.map(name => ({
                name,
                status: 'validating' as const,
            }));
            setRepos(initialRepos);
            
            // Validate all repos
            repoNames.forEach(validateRepo);
        }
    }, []);

    const validateRepo = async (repoName: string) => {
        try {
            const res = await fetch(
                `/plugins/${PLUGIN_ID}/api/v1/github/repo/validate?repo=${encodeURIComponent(repoName)}`
            );
            const data = await res.json();
            
            setRepos(prev => prev.map(r => {
                if (r.name === repoName) {
                    if (data.error) {
                        return { ...r, status: 'error', message: data.error };
                    }
                    return { 
                        ...r, 
                        status: data.private ? 'private' : 'valid',
                        message: data.private ? 'Private' : 'Public'
                    };
                }
                return r;
            }));
        } catch (err) {
            setRepos(prev => prev.map(r => {
                if (r.name === repoName) {
                    return { ...r, status: 'error', message: 'Failed to validate' };
                }
                return r;
            }));
        }
    };

    const updateValue = useCallback((newRepos: RepoStatus[]) => {
        const value = newRepos.map(r => r.name).join(',');
        onChange(id, value);
        setSaveNeeded();
    }, [id, onChange, setSaveNeeded]);

    const addRepo = async (repoName: string) => {
        repoName = repoName.trim();
        if (!repoName) return;
        
        // Check for duplicates
        if (repos.some(r => r.name.toLowerCase() === repoName.toLowerCase())) {
            return;
        }

        const newRepo: RepoStatus = {
            name: repoName,
            status: 'validating',
        };
        
        const newRepos = [...repos, newRepo];
        setRepos(newRepos);
        updateValue(newRepos);
        setInputValue('');
        
        // Validate the new repo
        validateRepo(repoName);
    };

    const removeRepo = (repoName: string) => {
        const newRepos = repos.filter(r => r.name !== repoName);
        setRepos(newRepos);
        updateValue(newRepos);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addRepo(inputValue);
        } else if (e.key === 'Backspace' && !inputValue && repos.length > 0) {
            // Remove last repo on backspace when input is empty
            removeRepo(repos[repos.length - 1].name);
        }
    };

    const getStatusIcon = (status: RepoStatus['status']) => {
        switch (status) {
            case 'validating':
                return <span className="repo-icon validating">⏳</span>;
            case 'valid':
                return <span className="repo-icon valid">🌐</span>;
            case 'private':
                return <span className="repo-icon private">🔒</span>;
            case 'error':
                return <span className="repo-icon error">❌</span>;
        }
    };

    return (
        <div className="repositories-input-container">
            <label className="repositories-label">{label}</label>
            <p className="repositories-help">{helpText}</p>
            
            <div className="repositories-input-wrapper">
                <div className="repos-tags">
                    {repos.map(repo => (
                        <div 
                            key={repo.name} 
                            className={`repo-tag ${repo.status}`}
                            title={repo.message}
                        >
                            {getStatusIcon(repo.status)}
                            <span className="repo-name">{repo.name}</span>
                            <button 
                                type="button"
                                className="repo-remove"
                                onClick={() => removeRepo(repo.name)}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    <input
                        type="text"
                        className="repo-input"
                        placeholder={repos.length === 0 ? "org/repo" : ""}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onBlur={() => {
                            if (inputValue.trim()) {
                                addRepo(inputValue);
                            }
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

export default RepositoriesInput;
