# Mattermost GitHub Activity Reports

A Mattermost plugin that displays team GitHub activity in the right-hand sidebar.

## Features

- 📊 **Activity Dashboard** - View commits, lines added/removed per team member
- 🔗 **GitHub ↔ Mattermost Mapping** - Link GitHub accounts to Mattermost users
- 📅 **Date Range Filtering** - Filter activity by week ranges
- 👥 **User Filtering** - Multi-select team members to compare
- 📈 **Visual Statistics** - Progress bars and summary cards

## Installation

### From Release

1. Download the latest release `.tar.gz` file
2. Go to **System Console → Plugins → Plugin Management**
3. Upload the plugin
4. Enable the plugin

### From Source

```bash
make dist-linux
# Upload dist/github-reports-X.X.X.tar.gz to Mattermost
```

## Configuration

Go to **System Console → Plugins → GitHub Activity Reports**:

| Setting | Description |
|---------|-------------|
| GitHub Personal Access Token | Token with `repo` read access |
| GitHub Organization | Organization to fetch repos from |
| Repositories | Comma-separated list of repos to track |
| User Mappings | JSON mapping GitHub emails to MM usernames |

### User Mappings Example

```json
{
  "user@example.com": "mmuser1",
  "another@github.com": "mmuser2"
}
```

## Usage

1. Click the GitHub icon in the channel header
2. Select team members to view
3. Adjust the date range (format: `YYYY-WXX`)
4. View activity breakdown by user

## Development

```bash
# Build server
cd server && go build

# Build webapp
cd webapp && npm install && npm run build

# Full distribution
make dist-linux
```

## CI/CD

The plugin automatically deploys to Mattermost on push to `main` branch.

Required GitHub Secrets:
- `MM_URL` - Mattermost server URL
- `MM_ACCESS_TOKEN` - Bot token with plugin management permissions

## License

MIT
