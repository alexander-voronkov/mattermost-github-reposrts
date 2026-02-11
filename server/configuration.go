package main

type configuration struct {
	GitHubToken  string `json:"github_token"`
	Repositories string `json:"repositories"`
	UserMappings string `json:"user_mappings"`
}

func (c *configuration) Clone() *configuration {
	var clone = *c
	return &clone
}

func (p *Plugin) getConfiguration() *configuration {
	p.configurationLock.RLock()
	defer p.configurationLock.RUnlock()

	if p.configuration == nil {
		return &configuration{}
	}

	return p.configuration
}

func (p *Plugin) setConfiguration(configuration *configuration) {
	p.configurationLock.Lock()
	defer p.configurationLock.Unlock()
	p.configuration = configuration
}

func (p *Plugin) OnConfigurationChange() error {
	var configuration = new(configuration)

	if err := p.API.LoadPluginConfiguration(configuration); err != nil {
		return err
	}

	p.setConfiguration(configuration)
	return nil
}
