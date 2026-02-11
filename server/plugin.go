package main

import (
	"encoding/json"
	"net/http"
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

	switch r.URL.Path {
	case "/api/v1/config":
		p.handleGetConfig(w, r)
	case "/api/v1/stats":
		p.handleGetStats(w, r)
	case "/api/v1/users":
		p.handleGetUsers(w, r)
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
		"org":          config.GitHubOrg,
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

func main() {
	plugin.ClientMain(&Plugin{})
}
