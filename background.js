class BackgroundManager {
    constructor() {
        this.defaultTemplate = `# Locate the code corresponding to the user-selected element on the page and implement the user's requirement

## Role
You are a senior front-end engineer, highly skilled in all front-end technology stacks, including but not limited to:
- Fundamental technologies such as HTML, CSS, and JavaScript
- Mainstream front-end frameworks like React, Vue, Angular, and Next.js
- Modern JavaScript features, including TypeScript and ES6+
- CSS preprocessors (Sass, Less) and CSS-in-JS solutions
- Front-end build tools (Webpack, Vite, Rollup, etc.)
- Server-side rendering and full-stack solutions including Next.js and Node.js
- Front-end engineering and best practices

You are able to accurately understand user requirements, quickly locate the corresponding code in the project based on the element information from the browser, and efficiently implement the user's requirements.

---

## Task
**Please help me locate the corresponding code in the project according to the target element information from the browser, and modify the code to implement the user requirement.**

---

## User Requirement
{userInstruction}

## Content Information of the Target Element in the Browser

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
`

        this.init();
    }

    init() {
        this.setupMessageListeners();
        this.ensureDefaultTemplate();
        console.log('[Background] BackgroundManager 初始化完成');
    }

    async ensureContentScriptInjected(tabId) {
        try {
            // 先检查标签页信息，判断是否为特殊页面
            const tab = await chrome.tabs.get(tabId);
            if (tab && tab.url) {
                const url = tab.url;
                // 检查是否为特殊协议页面
                const isSpecialProtocol = /^(chrome|edge|about|moz-extension|chrome-extension):\/\//i.test(url);
                
                // 如果是 chrome-extension://，检查是否是当前扩展
                if (url.startsWith('chrome-extension://')) {
                    try {
                        const extensionId = chrome.runtime.id;
                        if (url.startsWith('chrome-extension://' + extensionId + '/')) {
                            // 是当前扩展的页面，可以注入
                            console.log('[Background] 当前扩展页面，允许注入');
                        } else {
                            // 是其他扩展的页面，不允许注入
                            console.log('[Background] 其他扩展页面，不允许注入:', url);
                            return false;
                        }
                    } catch (e) {
                        console.warn('[Background] 无法获取扩展ID，跳过注入:', e);
                        return false;
                    }
                } else if (isSpecialProtocol) {
                    // 其他特殊协议页面，不允许注入
                    console.log('[Background] 特殊协议页面，不允许注入:', url);
                    return false;
                }
            }
            
            // 先尝试检查 content script 是否已经存在
            try {
                const checkResponse = await new Promise((resolve) => {
                    chrome.tabs.sendMessage(tabId, {
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
                    console.log('[Background] Content script 已存在，无需注入');
                    return true;
                }
            } catch (checkError) {
                // 检查失败，继续尝试注入
                console.log('[Background] 检查 content script 是否存在失败，尝试注入');
            }
            
            // manifest.json 已配置自动注入，通常不需要手动注入
            // 只有在确实需要时才注入
            const result = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            });
            console.log('[Background] Content script 注入结果:', result);
            
            // 等待一下让 content script 初始化
            await new Promise(resolve => setTimeout(resolve, 100));
            
            return true;
        } catch (error) {
            console.error('[Background] 注入content script失败:', error);
            // 如果是因为权限问题或特殊页面，不抛出错误
            if (error.message && (
                error.message.includes('Cannot access') ||
                error.message.includes('Cannot execute') ||
                error.message.includes('chrome://')
            )) {
                console.warn('[Background] 特殊页面或权限受限，无法注入:', error.message);
                return false;
            }
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