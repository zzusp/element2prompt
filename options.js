class OptionsManager {
    constructor() {
        this.templateTextarea = document.getElementById('template');
        this.saveBtn = document.getElementById('saveBtn');
        this.resetBtn = document.getElementById('resetBtn');
        this.statusElement = document.getElementById('status');
        
        // 默认模板从 background.js 获取，避免代码重复
        this.defaultTemplate = null;

        this.init();
    }

    async init() {
        // 从 background 获取默认模板
        await this.loadDefaultTemplate();
        
        // 加载当前模板
        await this.loadTemplate();
        
        // 绑定事件
        this.bindEvents();
    }

    async loadDefaultTemplate() {
        try {
            const template = await this.getDefaultTemplate();
            this.defaultTemplate = template;
        } catch (error) {
            console.error('[Options] 获取默认模板失败:', error);
            // 如果获取失败，显示错误提示
            this.showStatus('无法获取默认模板，请刷新页面重试', 'error');
            // 设置为空，避免后续操作出错
            this.defaultTemplate = '';
        }
    }

    async getDefaultTemplate() {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'getDefaultTemplate' }, (response) => {
                if (response && response.success) {
                    resolve(response.template);
                } else {
                    reject(new Error(response?.error || '获取默认模板失败'));
                }
            });
        });
    }

    bindEvents() {
        this.saveBtn.addEventListener('click', () => this.saveTemplate());
        this.resetBtn.addEventListener('click', () => this.resetToDefault());
    }

    async loadTemplate() {
        try {
            const template = await this.getTemplate();
            this.templateTextarea.value = template;
        } catch (error) {
            console.error('[Options] 加载模板失败:', error);
            this.showStatus('加载模板失败', 'error');
        }
    }

    async getTemplate() {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'getTemplate' }, (response) => {
                if (response.success) {
                    resolve(response.template);
                } else {
                    reject(new Error(response.error || '获取模板失败'));
                }
            });
        });
    }

    async saveTemplate() {
        const template = this.templateTextarea.value.trim();
        
        if (!template) {
            this.showStatus('模板不能为空', 'error');
            return;
        }

        try {
            await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ 
                    action: 'saveTemplate',
                    template: template
                }, (response) => {
                    if (response.success) {
                        resolve();
                    } else {
                        reject(new Error(response.error || '保存模板失败'));
                    }
                });
            });
            
            this.showStatus('模板已保存', 'success');
        } catch (error) {
            console.error('[Options] 保存模板失败:', error);
            this.showStatus(`保存失败: ${error.message}`, 'error');
        }
    }

    resetToDefault() {
        if (this.defaultTemplate) {
            this.templateTextarea.value = this.defaultTemplate;
            this.showStatus('已恢复默认模板', 'success');
        } else {
            // 如果默认模板还未加载，先加载再设置
            this.loadDefaultTemplate().then(() => {
                if (this.defaultTemplate) {
                    this.templateTextarea.value = this.defaultTemplate;
                    this.showStatus('已恢复默认模板', 'success');
                } else {
                    this.showStatus('恢复默认模板失败', 'error');
                }
            }).catch(() => {
                this.showStatus('恢复默认模板失败', 'error');
            });
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
}

// 确保DOM加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.optionsManager = new OptionsManager();
    });
} else {
    window.optionsManager = new OptionsManager();
}