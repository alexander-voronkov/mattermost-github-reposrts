package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

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

func (p *Plugin) handleGetStats(w http.ResponseWriter, r *http.Request) {
	// For now, return sample data from KV store or static
	// In production, this would fetch from GitHub API
	
	statsKey := "github_stats_cache"
	data, appErr := p.API.KVGet(statsKey)
	if appErr != nil || data == nil {
		// Return sample structure
		sample := map[string]interface{}{
			"users":        []interface{}{},
			"lastUpdated":  "",
			"repositories": []string{},
		}
		json.NewEncoder(w).Encode(sample)
		return
	}

	w.Write(data)
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

// handleGetMattermostUsers returns all MM users for mapping dropdown
func (p *Plugin) handleGetMattermostUsers(w http.ResponseWriter, r *http.Request) {
	page := 0
	perPage := 200
	var allUsers []*model.User

	for {
		users, err := p.API.GetUsers(&model.UserGetOptions{
			Page:    page,
			PerPage: perPage,
			Active:  true,
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
	}

	result := make([]MMUser, 0, len(allUsers))
	for _, u := range allUsers {
		if u.IsBot {
			continue
		}
		result = append(result, MMUser{
			ID:        u.Id,
			Username:  u.Username,
			FirstName: u.FirstName,
			LastName:  u.LastName,
			Nickname:  u.Nickname,
			Email:     u.Email,
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

func main() {
	plugin.ClientMain(&Plugin{})
}
