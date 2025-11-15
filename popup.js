class PopupManager {
    constructor() {
        this.selectModeBtn = document.getElementById('selectModeBtn');
        this.exitSelectModeBtn = document.getElementById('exitSelectModeBtn');
        this.statusElement = document.getElementById('status');
        
        this.isSelectMode = false;
        this.currentTabId = null;
        
        this.init();
    }
    
    async init() {
        // 获取当前标签页ID
        this.currentTabId = await this.getCurrentTabId();
        
        if (!this.currentTabId) {
            this.showStatus('无法获取当前标签页ID', 'error');
            return;
        }
        
        // 绑定事件
        this.bindEvents();
        
        // 恢复选择状态
        await this.restoreSelectionState();
    }
    
    bindEvents() {
        if (this.selectModeBtn) {
            this.selectModeBtn.addEventListener('click', () => this.enterSelectMode());
        }
        
        if (this.exitSelectModeBtn) {
            this.exitSelectModeBtn.addEventListener('click', () => this.exitSelectMode());
        }
    }
    
    async getCurrentTabId() {
        return new Promise((resolve) => {
            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                if (chrome.runtime.lastError) {
                    console.error('[Popup] 获取标签页失败:', chrome.runtime.lastError);
                    resolve(null);
                    return;
                }
                
                const activeTab = tabs[0];
                if (!activeTab) {
                    console.error('[Popup] 未找到活动标签页');
                    resolve(null);
                    return;
                }
                
                console.log('[Popup] 获取到标签页:', {
                    id: activeTab.id,
                    url: activeTab.url,
                    title: activeTab.title
                });
                
                resolve(activeTab.id);
            });
        });
    }
    
    async executeInContentScript(action) {
        if (!this.currentTabId) {
            throw new Error('无法获取当前标签页ID');
        }

        // 使用消息传递机制，而不是直接执行代码
        try {
            const response = await new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(this.currentTabId, {
                    action: action
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        // 如果消息发送失败，可能是content script还没有加载，尝试注入
                        console.log('[Popup] 消息发送失败，尝试注入content script:', chrome.runtime.lastError.message);
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });
            
            console.log('[Popup] 操作执行结果:', response);
            return response && response.success;
        } catch (error) {
            console.info('[Popup] 执行操作失败:', error);
            // 如果消息传递失败，可能是content script还没有加载
            // 注意：manifest.json中已经配置了自动注入，通常不需要手动注入
            // 但如果确实需要，先检查是否已经注入
            try {
                // 先尝试检查content script是否已存在
                const checkResponse = await new Promise((resolve) => {
                    chrome.tabs.sendMessage(this.currentTabId, {
                        action: 'testConnection'
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            resolve(null);
                        } else {
                            resolve(response);
                        }
                    });
                });
                
                if (checkResponse) {
                    // content script已存在，再次尝试发送消息
                    const response = await new Promise((resolve, reject) => {
                        chrome.tabs.sendMessage(this.currentTabId, {
                            action: action
                        }, (response) => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                            } else {
                                resolve(response);
                            }
                        });
                    });
                    console.log('[Popup] 重试操作执行结果:', response);
                    return response && response.success;
                }
                
                // content script不存在，尝试注入（但通常不应该发生，因为manifest已配置自动注入）
                console.info('[Popup] Content script not found, attempting to inject (this should not happen)');
                await chrome.scripting.executeScript({
                    target: { tabId: this.currentTabId },
                    files: ['content.js']
                });
                
                // 等待一下让content script初始化
                await new Promise(resolve => setTimeout(resolve, 200));
                
                // 再次尝试发送消息
                const response = await new Promise((resolve, reject) => {
                    chrome.tabs.sendMessage(this.currentTabId, {
                        action: action
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve(response);
                        }
                    });
                });
                
                console.log('[Popup] 注入后操作执行结果:', response);
                return response && response.success;
            } catch (retryError) {
                console.error('[Popup] 重试也失败:', retryError);
                throw error;
            }
        }
    }
    
    async enterSelectMode() {
        try {
            await this.executeInContentScript('enterSelectMode');
            
            this.isSelectMode = true;
            this.updateUI();
            this.showStatus('已进入选择模式', 'success');
            
            // 保存状态
            await this.saveState();
        } catch (error) {
            this.showStatus(`进入选择模式失败: ${error.message}`, 'error');
            console.error('[Popup] 进入选择模式失败:', error);
        }
    }
    
    async exitSelectMode() {
        try {
            await this.executeInContentScript('exitSelectMode');
            
            this.isSelectMode = false;
            this.updateUI();
            this.showStatus('已退出选择模式', 'success');
            
            // 保存状态
            await this.saveState();
        } catch (error) {
            this.showStatus(`退出选择模式失败: ${error.message}`, 'error');
            console.error('[Popup] 退出选择模式失败:', error);
        }
    }
    
    updateUI() {
        if (this.isSelectMode) {
            this.selectModeBtn.style.display = 'none';
            this.exitSelectModeBtn.style.display = 'block';
        } else {
            this.selectModeBtn.style.display = 'block';
            this.exitSelectModeBtn.style.display = 'none';
        }
    }
    
    showStatus(message, type = 'info') {
        this.statusElement.textContent = message;
        this.statusElement.className = `status ${type}`;
        this.statusElement.style.display = 'block';
        
        // 3秒后自动隐藏
        setTimeout(() => {
            this.statusElement.style.display = 'none';
        }, 3000);
    }
    
    async saveState() {
        const state = {
            isSelectMode: this.isSelectMode,
            tabId: this.currentTabId
        };
        
        await chrome.storage.local.set({ selectionState: state });
        console.log('[Popup] 状态已保存:', state);
    }
    
    async restoreSelectionState() {
        try {
            const result = await chrome.storage.local.get('selectionState');
            const state = result.selectionState;
            
            if (state && state.tabId === this.currentTabId) {
                this.isSelectMode = state.isSelectMode;
                this.updateUI();
                
                if (this.isSelectMode) {
                    this.showStatus('恢复选择模式状态', 'info');
                }
            }
        } catch (error) {
            console.error('[Popup] 恢复状态失败:', error);
        }
    }
}

// 确保DOM加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.popupManager = new PopupManager();
    });
} else {
    window.popupManager = new PopupManager();
}