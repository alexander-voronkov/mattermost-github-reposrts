import Plugin from './plugin';

declare global {
    interface Window {
        registerPlugin: (pluginId: string, plugin: any) => void;
    }
}

window.registerPlugin('com.fambear.github-reports', new Plugin());
