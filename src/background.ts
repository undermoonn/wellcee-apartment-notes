async function enableSidePanelAction(): Promise<void> {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("[Wellcee Notes] 无法启用侧边栏入口", error);
  }
}

void enableSidePanelAction();
chrome.runtime.onInstalled.addListener(() => void enableSidePanelAction());
chrome.runtime.onStartup.addListener(() => void enableSidePanelAction());
