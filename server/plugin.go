package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

type Plugin struct {
	plugin.MattermostPlugin
	configurationLock sync.RWMutex
	configuration     *configuration
}

func (p *Plugin) OnActivate() error {
	p.API.LogInfo("GitHub Activity Reports plugin activated")
	return nil
}

func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Check user is logged in
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		http.Error(w, `{"error": "unauthorized"}`, http.StatusUnauthorized)
		return
	}

	switch r.URL.Path {
	case "/api/v1/config":
		p.handleGetConfig(w, r)
	case "/api/v1/stats":
		p.handleGetStats(w, r)
	case "/api/v1/users":
		p.handleGetUsers(w, r)
	case "/api/v1/github/contributors":
		p.handleGetGitHubContributors(w, r)
	case "/api/v1/mattermost/users":
		p.handleGetMattermostUsers(w, r)
	case "/api/v1/mappings":
		if r.Method == http.MethodPost {
			p.handleSaveMappings(w, r)
		} else {
			p.handleGetMappings(w, r)
		}
	case "/api/v1/github/repo/validate":
		p.handleValidateRepo(w, r)
	case "/api/v1/github/all-contributors":
		p.handleGetAllContributors(w, r)
	case "/api/v1/github/contributors-with-commits":
		p.handleGetContributorsWithCommits(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (p *Plugin) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()

	// Parse user mappings
	mappings := make(map[string]string)
	if config.UserMappings != "" {
		json.Unmarshal([]byte(config.UserMappings), &mappings)
	}

	response := map[string]interface{}{
		"repositories": config.Repositories,
		"mappings":     mappings,
	}

	json.NewEncoder(w).Encode(response)
}

// WeeklyRepoStats stores cached stats for a repo+week
type WeeklyRepoStats struct {
	Week      string                  `json:"week"`
	Repo      string                  `json:"repo"`
	Users     map[string]WeekUserStat `json:"users"` // github login -> stats
	FetchedAt string                  `json:"fetched_at"`
}

type WeekUserStat struct {
	Commits int `json:"commits"`
	Added   int `json:"added"`
	Removed int `json:"removed"`
}

// UserStats represents stats for a single user
type UserStats struct {
	MMUserID   string         `json:"mm_user_id"`
	MMUsername string         `json:"mm_username"`
	Name       string         `json:"name"`
	Commits    int            `json:"commits"`
	Added      int            `json:"added"`
	Removed    int            `json:"removed"`
	ByRepo     map[string]int `json:"by_repo"`
}

// StatsResponse represents the stats response
type StatsResponse struct {
	Users       []UserStats `json:"users"`
	Repos       []string    `json:"repos"`
	WeekStart   string      `json:"week_start"`
	WeekEnd     string      `json:"week_end"`
	LastUpdated string      `json:"last_updated"`
}

func (p *Plugin) handleGetStats(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	if config.GitHubToken == "" {
		http.Error(w, `{"error": "GitHub token not configured"}`, http.StatusBadRequest)
		return
	}

	weekStart := r.URL.Query().Get("week_start")
	weekEnd := r.URL.Query().Get("week_end")

	now := time.Now()
	currentYear, currentWeek := now.ISOWeek()
	currentWeekStr := fmt.Sprintf("%d-W%02d", currentYear, currentWeek)

	if weekStart == "" || weekEnd == "" {
		weekStart = fmt.Sprintf("%d-W%02d", currentYear, currentWeek-4)
		weekEnd = currentWeekStr
	}

	// Parse user mappings
	mappings := make(map[string]string)
	if config.UserMappings != "" {
		json.Unmarshal([]byte(config.UserMappings), &mappings)
	}

	repos := strings.Split(config.Repositories, ",")
	
	// Aggregate stats per user
	userCommits := make(map[string]int)
	userAdded := make(map[string]int)
	userRemoved := make(map[string]int)
	userByRepo := make(map[string]map[string]int)
	activeRepos := make(map[string]bool)

	// Generate list of weeks to fetch
	weeks := p.getWeeksInRange(weekStart, weekEnd)

	for _, repo := range repos {
		repo = strings.TrimSpace(repo)
		if repo == "" {
			continue
		}

		shortRepo := repo
		if idx := strings.Index(repo, "/"); idx >= 0 {
			shortRepo = repo[idx+1:]
		}

		for _, week := range weeks {
			weekStats := p.getWeeklyStats(repo, week, week == currentWeekStr, config.GitHubToken)
			if weekStats == nil {
				continue
			}

			for login, stat := range weekStats.Users {
				if stat.Commits > 0 {
					activeRepos[shortRepo] = true
				}
				userCommits[login] += stat.Commits
				userAdded[login] += stat.Added
				userRemoved[login] += stat.Removed
				if userByRepo[login] == nil {
					userByRepo[login] = make(map[string]int)
				}
				userByRepo[login][shortRepo] += stat.Commits
			}
		}
	}

	// Build response with MM user info
	var users []UserStats
	for ghLogin, commits := range userCommits {
		if commits == 0 {
			continue
		}
		mmUserID := mappings[ghLogin]
		mmUsername := ""
		name := ghLogin

		if mmUserID != "" {
			if user, err := p.API.GetUser(mmUserID); err == nil {
				mmUsername = user.Username
				if user.FirstName != "" || user.LastName != "" {
					name = strings.TrimSpace(user.FirstName + " " + user.LastName)
				} else if user.Nickname != "" {
					name = user.Nickname
				}
			}
		}

		users = append(users, UserStats{
			MMUserID:   mmUserID,
			MMUsername: mmUsername,
			Name:       name,
			Commits:    commits,
			Added:      userAdded[ghLogin],
			Removed:    userRemoved[ghLogin],
			ByRepo:     userByRepo[ghLogin],
		})
	}

	// Sort by commits desc
	for i := 0; i < len(users); i++ {
		for j := i + 1; j < len(users); j++ {
			if users[j].Commits > users[i].Commits {
				users[i], users[j] = users[j], users[i]
			}
		}
	}

	var reposList []string
	for r := range activeRepos {
		reposList = append(reposList, r)
	}

	response := StatsResponse{
		Users:       users,
		Repos:       reposList,
		WeekStart:   weekStart,
		WeekEnd:     weekEnd,
		LastUpdated: time.Now().Format(time.RFC3339),
	}

	json.NewEncoder(w).Encode(response)
}

// getWeeksInRange returns list of ISO weeks between start and end
func (p *Plugin) getWeeksInRange(start, end string) []string {
	var weeks []string
	current := start
	for current <= end {
		weeks = append(weeks, current)
		current = p.nextWeek(current)
	}
	return weeks
}

// nextWeek returns the next ISO week
func (p *Plugin) nextWeek(week string) string {
	var year, wn int
	fmt.Sscanf(week, "%d-W%d", &year, &wn)
	wn++
	// Check if week exists in year (most years have 52, some have 53)
	lastWeek := 52
	dec31 := time.Date(year, 12, 31, 0, 0, 0, 0, time.UTC)
	if _, w := dec31.ISOWeek(); w == 53 {
		lastWeek = 53
	}
	if wn > lastWeek {
		year++
		wn = 1
	}
	return fmt.Sprintf("%d-W%02d", year, wn)
}

// getWeeklyStats gets stats for a repo+week, using cache for past weeks
func (p *Plugin) getWeeklyStats(repo, week string, isCurrentWeek bool, token string) *WeeklyRepoStats {
	cacheKey := fmt.Sprintf("gh_stats_%s_%s", strings.ReplaceAll(repo, "/", "_"), week)

	// Try cache for past weeks
	if !isCurrentWeek {
		if data, err := p.API.KVGet(cacheKey); err == nil && data != nil {
			var cached WeeklyRepoStats
			if json.Unmarshal(data, &cached) == nil {
				return &cached
			}
		}
	}

	// Fetch from GitHub
	stats := p.fetchWeekFromGitHub(repo, week, token)
	if stats == nil {
		return nil
	}

	// Cache if not current week
	if !isCurrentWeek && len(stats.Users) > 0 {
		if data, err := json.Marshal(stats); err == nil {
			p.API.KVSet(cacheKey, data)
		}
	}

	return stats
}

// fetchWeekFromGitHub fetches commit stats for a specific week
func (p *Plugin) fetchWeekFromGitHub(repo, week, token string) *WeeklyRepoStats {
	startDate := weekToDate(week)
	endDate := startDate.AddDate(0, 0, 7)

	client := &http.Client{Timeout: 30 * time.Second}
	
	commitsURL := fmt.Sprintf(
		"https://api.github.com/repos/%s/commits?since=%s&until=%s&per_page=100",
		repo,
		startDate.Format(time.RFC3339),
		endDate.Format(time.RFC3339),
	)

	req, _ := http.NewRequest("GET", commitsURL, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := client.Do(req)
	if err != nil {
		p.API.LogWarn("GitHub API error", "repo", repo, "week", week, "error", err.Error())
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil
	}

	var commits []struct {
		SHA    string `json:"sha"`
		Author *struct {
			Login string `json:"login"`
		} `json:"author"`
	}
	json.NewDecoder(resp.Body).Decode(&commits)

	stats := &WeeklyRepoStats{
		Week:      week,
		Repo:      repo,
		Users:     make(map[string]WeekUserStat),
		FetchedAt: time.Now().Format(time.RFC3339),
	}

	// Count commits per user (skip fetching line counts to speed up)
	for _, c := range commits {
		if c.Author == nil || c.Author.Login == "" {
			continue
		}
		login := c.Author.Login
		s := stats.Users[login]
		s.Commits++
		stats.Users[login] = s
	}

	return stats
}

// weekToDate converts ISO week (2026-W05) to first day of that week
func weekToDate(isoWeek string) time.Time {
	// Parse "2026-W05" format
	var year, week int
	fmt.Sscanf(isoWeek, "%d-W%d", &year, &week)
	
	// Find first day of year
	firstDay := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	
	// Find first Monday
	offset := int(time.Monday - firstDay.Weekday())
	if offset > 0 {
		offset -= 7
	}
	firstMonday := firstDay.AddDate(0, 0, offset)
	
	// Add weeks
	return firstMonday.AddDate(0, 0, (week-1)*7)
}

func (p *Plugin) handleGetUsers(w http.ResponseWriter, r *http.Request) {
	// Get all MM users that have GitHub mappings
	config := p.getConfiguration()
	
	mappings := make(map[string]string)
	if config.UserMappings != "" {
		json.Unmarshal([]byte(config.UserMappings), &mappings)
	}

	// Get MM users
	var users []*model.User
	for _, mmUsername := range mappings {
		user, err := p.API.GetUserByUsername(mmUsername)
		if err == nil && user != nil {
			users = append(users, user)
		}
	}

	response := make([]map[string]string, 0)
	for _, u := range users {
		response = append(response, map[string]string{
			"id":       u.Id,
			"username": u.Username,
			"nickname": u.Nickname,
			"email":    u.Email,
		})
	}

	json.NewEncoder(w).Encode(response)
}

// GitHubContributor represents a GitHub user/contributor
type GitHubContributor struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatar_url"`
	Name      string `json:"name"`
	Email     string `json:"email"`
}

// GitHubRepo represents repository info
type GitHubRepo struct {
	Name     string `json:"name"`
	FullName string `json:"full_name"`
	Private  bool   `json:"private"`
}

// handleValidateRepo validates a single repository
func (p *Plugin) handleValidateRepo(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	if config.GitHubToken == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "GitHub token not configured",
		})
		return
	}

	repo := r.URL.Query().Get("repo")
	if repo == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "repo parameter required",
		})
		return
	}

	client := &http.Client{}
	url := fmt.Sprintf("https://api.github.com/repos/%s", repo)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+config.GitHubToken)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := client.Do(req)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Failed to connect to GitHub",
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Repository not found",
		})
		return
	}

	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "No access to repository",
		})
		return
	}

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": fmt.Sprintf("GitHub API error: %s", string(body)),
		})
		return
	}

	var repoInfo GitHubRepo
	if err := json.NewDecoder(resp.Body).Decode(&repoInfo); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Failed to parse response",
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"name":    repoInfo.FullName,
		"private": repoInfo.Private,
	})
}

// handleGetAllContributors fetches all contributors from repos + org members
func (p *Plugin) handleGetAllContributors(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	if config.GitHubToken == "" {
		http.Error(w, `{"error": "GitHub token not configured"}`, http.StatusBadRequest)
		return
	}

	client := &http.Client{}
	contributorsMap := make(map[string]GitHubContributor)

	// Get contributors from repositories
	repos := strings.Split(config.Repositories, ",")
	for _, repo := range repos {
		repo = strings.TrimSpace(repo)
		if repo == "" {
			continue
		}

		// Get contributors
		url := fmt.Sprintf("https://api.github.com/repos/%s/contributors?per_page=100", repo)
		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("Authorization", "Bearer "+config.GitHubToken)
		req.Header.Set("Accept", "application/vnd.github+json")

		resp, err := client.Do(req)
		if err != nil {
			continue
		}

		if resp.StatusCode == 200 {
			var contributors []GitHubContributor
			json.NewDecoder(resp.Body).Decode(&contributors)
			for _, c := range contributors {
				if c.Login != "" {
					contributorsMap[c.Login] = c
				}
			}
		}
		resp.Body.Close()
	}

	// Try to get org members if repo has org prefix
	orgsChecked := make(map[string]bool)
	for _, repo := range repos {
		repo = strings.TrimSpace(repo)
		parts := strings.Split(repo, "/")
		if len(parts) >= 1 {
			org := parts[0]
			if orgsChecked[org] {
				continue
			}
			orgsChecked[org] = true

			url := fmt.Sprintf("https://api.github.com/orgs/%s/members?per_page=100", org)
			req, _ := http.NewRequest("GET", url, nil)
			req.Header.Set("Authorization", "Bearer "+config.GitHubToken)
			req.Header.Set("Accept", "application/vnd.github+json")

			resp, err := client.Do(req)
			if err != nil {
				continue
			}

			if resp.StatusCode == 200 {
				var members []GitHubContributor
				json.NewDecoder(resp.Body).Decode(&members)
				for _, m := range members {
					if m.Login != "" {
						contributorsMap[m.Login] = m
					}
				}
			}
			resp.Body.Close()
		}
	}

	// Convert to slice
	result := make([]GitHubContributor, 0, len(contributorsMap))
	for _, c := range contributorsMap {
		result = append(result, c)
	}

	json.NewEncoder(w).Encode(result)
}

// handleGetGitHubContributors fetches contributors from configured repositories
func (p *Plugin) handleGetGitHubContributors(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	if config.GitHubToken == "" {
		http.Error(w, `{"error": "GitHub token not configured"}`, http.StatusBadRequest)
		return
	}

	repos := strings.Split(config.Repositories, ",")
	contributorsMap := make(map[string]GitHubContributor)

	client := &http.Client{}

	for _, repo := range repos {
		repo = strings.TrimSpace(repo)
		if repo == "" {
			continue
		}

		url := fmt.Sprintf("https://api.github.com/repos/%s/contributors", repo)
		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("Authorization", "Bearer "+config.GitHubToken)
		req.Header.Set("Accept", "application/vnd.github+json")

		resp, err := client.Do(req)
		if err != nil {
			p.API.LogWarn("Failed to fetch contributors", "repo", repo, "error", err.Error())
			continue
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			body, _ := io.ReadAll(resp.Body)
			p.API.LogWarn("GitHub API error", "repo", repo, "status", resp.StatusCode, "body", string(body))
			continue
		}

		var contributors []GitHubContributor
		if err := json.NewDecoder(resp.Body).Decode(&contributors); err != nil {
			p.API.LogWarn("Failed to decode contributors", "repo", repo, "error", err.Error())
			continue
		}

		for _, c := range contributors {
			if c.Login != "" {
				contributorsMap[c.Login] = c
			}
		}
	}

	// Convert map to slice
	result := make([]GitHubContributor, 0, len(contributorsMap))
	for _, c := range contributorsMap {
		result = append(result, c)
	}

	json.NewEncoder(w).Encode(result)
}

// handleGetMattermostUsers returns all MM users for mapping dropdown (including inactive and bots)
func (p *Plugin) handleGetMattermostUsers(w http.ResponseWriter, r *http.Request) {
	page := 0
	perPage := 200
	var allUsers []*model.User

	for {
		users, err := p.API.GetUsers(&model.UserGetOptions{
			Page:    page,
			PerPage: perPage,
			Active:  false, // Include inactive users too
		})
		if err != nil {
			p.API.LogError("Failed to get users", "error", err.Error())
			break
		}
		if len(users) == 0 {
			break
		}
		allUsers = append(allUsers, users...)
		if len(users) < perPage {
			break
		}
		page++
	}

	// Return simplified user data with avatar URLs
	type MMUser struct {
		ID        string `json:"id"`
		Username  string `json:"username"`
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
		Nickname  string `json:"nickname"`
		Email     string `json:"email"`
		IsBot     bool   `json:"is_bot"`
		DeleteAt  int64  `json:"delete_at"`
	}

	result := make([]MMUser, 0, len(allUsers))
	for _, u := range allUsers {
		// Include everyone: active, inactive, bots
		result = append(result, MMUser{
			ID:        u.Id,
			Username:  u.Username,
			FirstName: u.FirstName,
			LastName:  u.LastName,
			Nickname:  u.Nickname,
			Email:     u.Email,
			IsBot:     u.IsBot,
			DeleteAt:  u.DeleteAt,
		})
	}

	json.NewEncoder(w).Encode(result)
}

// handleGetMappings returns current user mappings
func (p *Plugin) handleGetMappings(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	
	mappings := make(map[string]string)
	if config.UserMappings != "" {
		json.Unmarshal([]byte(config.UserMappings), &mappings)
	}

	json.NewEncoder(w).Encode(mappings)
}

// handleSaveMappings saves user mappings (admin only)
func (p *Plugin) handleSaveMappings(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-Id")
	
	// Check if user is admin
	user, err := p.API.GetUser(userID)
	if err != nil {
		http.Error(w, `{"error": "failed to get user"}`, http.StatusInternalServerError)
		return
	}
	if !user.IsSystemAdmin() {
		http.Error(w, `{"error": "admin only"}`, http.StatusForbidden)
		return
	}

	var mappings map[string]string
	if err := json.NewDecoder(r.Body).Decode(&mappings); err != nil {
		http.Error(w, `{"error": "invalid json"}`, http.StatusBadRequest)
		return
	}

	// Serialize and save to KV store
	data, _ := json.Marshal(mappings)
	
	// Update plugin config via API
	config := p.getConfiguration()
	config.UserMappings = string(data)
	
	// Save to KV as backup/primary storage
	if err := p.API.KVSet("user_mappings", data); err != nil {
		p.API.LogError("Failed to save mappings", "error", err.Error())
		http.Error(w, `{"error": "failed to save"}`, http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// ContributorCommit represents a single commit
type ContributorCommit struct {
	SHA     string `json:"sha"`
	Message string `json:"message"`
	Date    string `json:"date"`
}

// ContributorWithCommits represents a contributor with their recent commits per repo
type ContributorWithCommits struct {
	Login     string                         `json:"login"`
	AvatarURL string                         `json:"avatar_url"`
	Repos     map[string][]ContributorCommit `json:"repos"` // repo -> commits
}

// handleGetContributorsWithCommits fetches all contributors with their last 3 commits per repo
// Optimized: fetches recent commits per repo and groups by author (fewer API calls)
func (p *Plugin) handleGetContributorsWithCommits(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	if config.GitHubToken == "" {
		http.Error(w, `{"error": "GitHub token not configured"}`, http.StatusBadRequest)
		return
	}

	client := &http.Client{}
	contributorsMap := make(map[string]*ContributorWithCommits)

	repos := strings.Split(config.Repositories, ",")
	for _, repo := range repos {
		repo = strings.TrimSpace(repo)
		if repo == "" {
			continue
		}

		shortRepo := repo
		if idx := strings.Index(repo, "/"); idx >= 0 {
			shortRepo = repo[idx+1:]
		}

		// Check if repo is a fork and get creation date
		var sinceDate string
		repoInfoURL := fmt.Sprintf("https://api.github.com/repos/%s", repo)
		repoReq, _ := http.NewRequest("GET", repoInfoURL, nil)
		repoReq.Header.Set("Authorization", "Bearer "+config.GitHubToken)
		repoReq.Header.Set("Accept", "application/vnd.github+json")

		repoResp, repoErr := client.Do(repoReq)
		if repoErr == nil && repoResp.StatusCode == 200 {
			var repoInfo struct {
				Fork      bool   `json:"fork"`
				CreatedAt string `json:"created_at"`
			}
			json.NewDecoder(repoResp.Body).Decode(&repoInfo)
			repoResp.Body.Close()

			if repoInfo.Fork && repoInfo.CreatedAt != "" {
				// Use fork creation date to filter commits
				sinceDate = repoInfo.CreatedAt
			}
		} else if repoResp != nil {
			repoResp.Body.Close()
		}

		// Get recent commits for this repo (100 commits should cover most contributors)
		commitsURL := fmt.Sprintf("https://api.github.com/repos/%s/commits?per_page=100", repo)
		if sinceDate != "" {
			commitsURL += "&since=" + sinceDate
		}
		req, _ := http.NewRequest("GET", commitsURL, nil)
		req.Header.Set("Authorization", "Bearer "+config.GitHubToken)
		req.Header.Set("Accept", "application/vnd.github+json")

		resp, err := client.Do(req)
		if err != nil || resp.StatusCode != 200 {
			if resp != nil {
				resp.Body.Close()
			}
			continue
		}

		var commits []struct {
			SHA    string `json:"sha"`
			Commit struct {
				Message string `json:"message"`
				Author  struct {
					Date string `json:"date"`
				} `json:"author"`
			} `json:"commit"`
			Author *struct {
				Login     string `json:"login"`
				AvatarURL string `json:"avatar_url"`
			} `json:"author"`
		}
		json.NewDecoder(resp.Body).Decode(&commits)
		resp.Body.Close()

		// Group commits by author
		authorCommits := make(map[string][]ContributorCommit)
		authorInfo := make(map[string]struct {
			Login     string
			AvatarURL string
		})

		for _, c := range commits {
			if c.Author == nil || c.Author.Login == "" {
				continue
			}

			login := c.Author.Login

			// Store author info
			if _, exists := authorInfo[login]; !exists {
				authorInfo[login] = struct {
					Login     string
					AvatarURL string
				}{c.Author.Login, c.Author.AvatarURL}
			}

			// Only keep first 3 commits per author per repo
			if len(authorCommits[login]) >= 3 {
				continue
			}

			// Truncate message to first line
			msg := c.Commit.Message
			if idx := strings.Index(msg, "\n"); idx > 0 {
				msg = msg[:idx]
			}
			if len(msg) > 80 {
				msg = msg[:77] + "..."
			}

			date := c.Commit.Author.Date
			if len(date) >= 10 {
				date = date[:10]
			}

			sha := c.SHA
			if len(sha) > 7 {
				sha = sha[:7]
			}

			authorCommits[login] = append(authorCommits[login], ContributorCommit{
				SHA:     sha,
				Message: msg,
				Date:    date,
			})
		}

		// Merge into contributorsMap
		for login, commits := range authorCommits {
			if contributorsMap[login] == nil {
				info := authorInfo[login]
				contributorsMap[login] = &ContributorWithCommits{
					Login:     info.Login,
					AvatarURL: info.AvatarURL,
					Repos:     make(map[string][]ContributorCommit),
				}
			}
			contributorsMap[login].Repos[shortRepo] = commits
		}
	}

	// Convert to slice
	result := make([]*ContributorWithCommits, 0, len(contributorsMap))
	for _, c := range contributorsMap {
		result = append(result, c)
	}

	json.NewEncoder(w).Encode(result)
}

func main() {
	plugin.ClientMain(&Plugin{})
}
