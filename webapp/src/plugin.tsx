import React from 'react';
import GitHubReportsRHS from './components/rhs';
import UserMappingsComponent from './components/user_mappings';
import RepositoriesInput from './components/repositories_input';

// Base64 encoded 24x24 PNG icon (bar chart with dots)
const ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYEAIAAAA/hXbsAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAHdElNRQfqAgsLLgzYLuzDAAABAUlEQVRIx2OUkpKS0tNjGDSAiZ6WsQWzNbCJlc2v+lSkf+3anTvnzkHYEHGIGmZeXl5ecXH6OKi4rHxTvkqCedKrmPkQEQMZw1K9AA5uTheOvUc3HmY//hIlhIjxASUA2Sm4xFEcVOBTUpQjiSwNYUPEKXfQgpPzxJYk4hdHcRAxPqAETNjS0zflObL1EDZEHCLCiJzLIBGEaT1EW1diG1/fRVyW2dn19FzEInvoUEmJvj7xjkYJIWJ8QGvASK1yiCYhNBgAC/FKVVXnz1dSwhS/fTsx8d49ajloKIcQJYD40B3cIUStnEIJGHQhNOqgUQcNOwdRrXKlFhh0ITToHAQAF9CL1EI8yFoAAAAASUVORK5CYII=';

export default class Plugin {
    initialize(registry: any, store: any) {
        // Register custom admin console settings
        if (registry.registerAdminConsoleCustomSetting) {
            registry.registerAdminConsoleCustomSetting(
                'repositories',
                RepositoriesInput
            );
            registry.registerAdminConsoleCustomSetting(
                'user_mappings',
                UserMappingsComponent
            );
        }
        // Register RHS component
        const {toggleRHSPlugin} = registry.registerRightHandSidebarComponent(
            GitHubReportsRHS,
            'GitHub Activity'
        );

        // Register channel header button to toggle RHS
        registry.registerChannelHeaderButtonAction(
            <ReportsIcon />,
            () => store.dispatch(toggleRHSPlugin),
            'GitHub Activity',
            'View team GitHub activity'
        );

        // Register main menu item
        registry.registerMainMenuAction(
            'GitHub Activity',
            () => store.dispatch(toggleRHSPlugin),
            <ReportsIcon />
        );
    }
}

const ReportsIcon = () => (
    <img 
        src={`data:image/png;base64,${ICON_BASE64}`}
        alt="GitHub Reports"
        width={16}
        height={16}
        style={{display: 'block'}}
    />
);
