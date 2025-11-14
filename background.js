class BackgroundManager {
    constructor() {
        this.defaultTemplate = `# Task: Modify Web Element

## User Requirement
{userInstruction}

## Target Element Context

### Basic Information
- **Page URL**: {pageUrl}
- **Tag Name**: {tagName}
- **Element ID**: {id}
- **Class Name**: {className}
- **Text Content**: {textContent}
- **DOM Path**: \`{domPath}\`

### HTML Structure
\`\`\`html
{html}
\`\`\`

### Current CSS Styles
\`\`\`css
{css}
\`\`\`

---

**Please help me modify the target element according to the user requirement above.**`;

        this.init();
    }

    init() {
        this.setupMessageListeners();
        this.ensureDefaultTemplate();
        console.log('[Background] BackgroundManager 初始化完成');
    }

    async ensureContentScriptInjected(tabId) {
        try {
            const result = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            });
            console.log('[Background] Content script 注入结果:', result);
            return true;
        } catch (error) {
            console.error('[Background] 注入content script失败:', error);
            return false;
        }
    }

    setupMessageListeners() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            console.log('[Background] 收到消息:', message);

            switch (message.action) {
                case 'testConnection':
                    console.log('[Background] 收到测试连接消息');
                    sendResponse({ success: true, message: 'Background已收到测试消息' });
                    return false; // 同步响应

                case 'enterSelectMode':
                case 'exitSelectMode':
                    // 如果消息来自content script（有sender.tab），直接转发到content script
                    if (sender.tab && sender.tab.id) {
                        // 消息来自content script，直接转发到同一个tab的content script
                        chrome.tabs.sendMessage(sender.tab.id, {
                            action: message.action
                        }, (response) => {
                            if (chrome.runtime.lastError) {
                                console.error('[Background] 转发消息失败:', chrome.runtime.lastError);
                                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                            } else {
                                sendResponse(response || { success: true });
                            }
                        });
                        return true; // 异步响应
                    }
                    
                    // 如果消息来自popup（需要tabId参数），先确保content script已注入
                    if (message.tabId) {
                        this.ensureContentScriptInjected(message.tabId).then(success => {
                            if (!success) {
                                sendResponse({ success: false, error: '无法注入content script' });
                                return;
                            }

                            // 尝试发送消息到content script
                            chrome.tabs.sendMessage(message.tabId, {
                                action: message.action
                            }, (response) => {
                                if (chrome.runtime.lastError) {
                                    console.error('[Background] 转发消息失败:', chrome.runtime.lastError);
                                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                                } else {
                                    sendResponse(response || { success: true });
                                }
                            });
                        }).catch(error => {
                            console.error('[Background] 注入content script失败:', error);
                            sendResponse({ success: false, error: error.message });
                        });
                        return true; // 异步响应
                    }
                    
                    // 既没有sender.tab也没有tabId，返回错误
                    sendResponse({ success: false, error: '缺少tabId参数或消息来源无效' });
                    return false;

                case 'processElementInfo':
                    // 立即返回true保持通道开放
                    this.processElementInfo(message.elementInfo)
                        .then(result => {
                            try {
                                sendResponse({ success: true, result });
                            } catch (err) {
                                console.error('[Background] 发送响应失败:', err);
                            }
                        })
                        .catch(error => {
                            console.error('[Background] processElementInfo 错误:', error);
                            try {
                                sendResponse({ success: false, error: error.message || '处理失败' });
                            } catch (err) {
                                console.error('[Background] 发送错误响应失败:', err);
                            }
                        });
                    return true; // 保持通道开放以支持异步响应

                case 'getTemplate':
                    this.getTemplate()
                        .then(template => {
                            try {
                                sendResponse({ success: true, template });
                            } catch (err) {
                                console.error('[Background] 发送响应失败:', err);
                            }
                        })
                        .catch(error => {
                            try {
                                sendResponse({ success: false, error: error.message });
                            } catch (err) {
                                console.error('[Background] 发送错误响应失败:', err);
                            }
                        });
                    return true;

                case 'getDefaultTemplate':
                    sendResponse({ success: true, template: this.defaultTemplate });
                    return false; // 同步响应

                case 'saveTemplate':
                    this.saveTemplate(message.template)
                        .then(() => {
                            try {
                                sendResponse({ success: true });
                            } catch (err) {
                                console.error('[Background] 发送响应失败:', err);
                            }
                        })
                        .catch(error => {
                            try {
                                sendResponse({ success: false, error: error.message });
                            } catch (err) {
                                console.error('[Background] 发送错误响应失败:', err);
                            }
                        });
                    return true;

                case 'getCurrentTabId':
                    if (sender.tab) {
                        sendResponse({ success: true, tabId: sender.tab.id });
                    } else {
                        sendResponse({ success: false, error: '无法获取标签页ID' });
                    }
                    return false; // 同步响应

                default:
                    sendResponse({ success: false, error: '未知操作' });
                    return false; // 同步响应
            }
        });
    }

    async ensureDefaultTemplate() {
        const result = await chrome.storage.local.get('promptTemplate');
        if (!result.promptTemplate) {
            await chrome.storage.local.set({ promptTemplate: this.defaultTemplate });
            console.log('[Background] 已设置默认模板');
        }
    }

    async getTemplate() {
        const result = await chrome.storage.local.get('promptTemplate');
        return result.promptTemplate || this.defaultTemplate;
    }

    async saveTemplate(template) {
        await chrome.storage.local.set({ promptTemplate: template });
        console.log('[Background] 模板已保存');
    }

    async processElementInfo(elementInfo) {
        try {
            // 获取模板
            const template = await this.getTemplate();
            
            // 填充模板
            const filledTemplate = this.fillTemplate(template, elementInfo);
            
            // 返回填充后的模板，由content script负责复制
            return {
                template: filledTemplate,
                elementInfo: elementInfo
            };
        } catch (error) {
            console.error('[Background] 处理元素信息失败:', error);
            throw error;
        }
    }

    fillTemplate(template, elementInfo) {
        // 用户指令现在是必填的，所以直接使用
        const userInstruction = elementInfo.userInstruction || '';
        
        let filled = template
            .replace(/{userInstruction}/g, userInstruction)
            .replace(/{pageUrl}/g, elementInfo.pageUrl || '')
            .replace(/{html}/g, elementInfo.html || '')
            .replace(/{css}/g, elementInfo.css || '')
            .replace(/{domPath}/g, elementInfo.domPath?.join(' > ') || '')
            .replace(/{tagName}/g, elementInfo.tagName || '')
            .replace(/{id}/g, elementInfo.id || '')
            .replace(/{className}/g, elementInfo.className || '')
            .replace(/{textContent}/g, elementInfo.textContent || '');
        
        return filled;
    }

    async copyToClipboard(text) {
        // Service Worker中无法直接使用clipboard API，需要通过content script来复制
        // 返回文本内容，让content script来执行复制操作
        return text;
    }
}

// 初始化
const backgroundManager = new BackgroundManager();