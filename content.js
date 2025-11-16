// 防止重复声明类
if (typeof window.__CONTENT_EXTRACTOR_CLASS_DECLARED__ === 'undefined') {
    window.__CONTENT_EXTRACTOR_CLASS_DECLARED__ = true;

class ContentExtractor {
    constructor() {
        this.isSelectMode = false;
        this.selectedElement = null;
        this.isSelectionLocked = false; // 标记选中是否已锁定
        this.toolbar = null;
        this.messageListenerRegistered = false;
        this.highlightOverlay = null; // 选中框覆盖层
        this.isDragging = false; // 是否正在拖拽
        this.dragOffset = { x: 0, y: 0 }; // 拖拽偏移量
        
        console.log('[Content] ContentExtractor instance created');
        this.init();
    }
    
    init() {
        this.setupMessageListener();
        console.log('[Content] ContentExtractor initialized');
    }
    
    setupMessageListener() {
        // 防止重复注册消息监听器
        if (this.messageListenerRegistered) {
            console.log('[Content] Message listener already registered');
            return;
        }
        
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            console.log('[Content] Received message:', message);
            
            switch (message.action) {
                case 'testConnection':
                    sendResponse({ success: true, message: 'Content script is ready' });
                    return false; // 同步响应
                    
                case 'enterSelectMode':
                    try {
                        this.enterSelectMode();
                        sendResponse({ success: true, message: '已进入选择模式' });
                    } catch (error) {
                        console.error('[Content] 进入选择模式失败:', error);
                        sendResponse({ success: false, error: error.message });
                    }
                    return true; // 保持通道开放，以防需要异步响应
                    
                case 'exitSelectMode':
                    try {
                        this.exitSelectMode();
                        sendResponse({ success: true, message: '已退出选择模式' });
                    } catch (error) {
                        console.error('[Content] 退出选择模式失败:', error);
                        sendResponse({ success: false, error: error.message });
                    }
                    return true;
                    
                case 'getElementInfo':
                    this.getElementInfo().then(info => {
                        sendResponse({ success: true, info });
                    }).catch(error => {
                        sendResponse({ success: false, error: error.message });
                    });
                    return true; // 异步响应
                    
                default:
                    console.log('[Content] Unknown action:', message.action);
                    sendResponse({ success: false, error: '未知操作' });
                    return false;
            }
        });
        
        this.messageListenerRegistered = true;
        console.log('[Content] Message listener registered successfully');
    }
    
    enterSelectMode() {
        if (this.isSelectMode) {
            console.log('[Content] Already in select mode');
            return;
        }
        
        console.log('[Content] Entering select mode');
        this.isSelectMode = true;
        
        // 确保DOM准备好后再创建toolbar和设置选择
        const initSelection = () => {
            if (document.body) {
                this.createToolbar();
                this.setupElementSelection();
                console.log('[Content] Successfully entered select mode');
            } else {
                // 如果body还不存在，等待DOM加载
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', initSelection, { once: true });
                } else {
                    // 已经加载完成但body不存在，稍等再试
                    setTimeout(initSelection, 100);
                }
            }
        };
        
        initSelection();
    }
    
    async exitSelectMode() {
        if (!this.isSelectMode) {
            console.log('[Content] Not in select mode');
            return;
        }
        
        console.log('[Content] Exiting select mode');
        this.isSelectMode = false;
        this.isSelectionLocked = false; // 解除锁定
        this.removeToolbar();
        this.cleanupElementSelection();
        
        // 更新storage状态，以便popup下次打开时能恢复状态
        try {
            // 获取当前tabId
            chrome.runtime.sendMessage({ action: 'getCurrentTabId' }, (response) => {
                if (response && response.success && response.tabId) {
                    chrome.storage.local.set({
                        selectionState: {
                            isSelectMode: false,
                            tabId: response.tabId
                        }
                    }, () => {
                        console.log('[Content] 退出状态已保存到storage');
                    });
                }
            });
        } catch (error) {
            console.error('[Content] 保存退出状态失败:', error);
        }
        
        console.log('[Content] Successfully exited select mode');
    }
    
    createToolbar() {
        if (this.toolbar) return;
        
        console.log('[Content] Creating toolbar');
        
        // 确保document.body存在
        const ensureBody = () => {
            if (document.body) {
                return Promise.resolve();
            }
            return new Promise((resolve) => {
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', resolve, { once: true });
                } else {
                    // 如果已经加载完成但body还不存在，等待一下
                    setTimeout(resolve, 50);
                }
            });
        };
        
        ensureBody().then(() => {
            if (this.toolbar) return; // 防止重复创建
            
            // 创建悬浮工具栏
            this.toolbar = document.createElement('div');
            this.toolbar.style.cssText = `
                position: fixed;
                top: 20px;
                left: 20px;
                background: #ffffff;
                border: none;
                border-radius: 16px;
                padding: 0;
                z-index: 2147483647;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.05);
                min-width: 320px;
                max-width: 480px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', Roboto, 'Helvetica Neue', Arial, sans-serif;
                animation: slideInToolbar 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                overflow: hidden;
            `;
            
            // 添加动画样式
            if (!document.getElementById('toolbar-styles')) {
                const style = document.createElement('style');
                style.id = 'toolbar-styles';
                style.textContent = `
                    @keyframes slideInToolbar {
                        from {
                            opacity: 0;
                            transform: translateY(-20px) scale(0.95);
                        }
                        to {
                            opacity: 1;
                            transform: translateY(0) scale(1);
                        }
                    }
                    @keyframes shake {
                        0%, 100% { transform: translateX(0); }
                        10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
                        20%, 40%, 60%, 80% { transform: translateX(5px); }
                    }
                `;
                document.head.appendChild(style);
            }
            
            this.toolbar.innerHTML = `
                <div id="toolbarHeader" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 16px 20px; color: white; display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none;">
                    <div>
                        <div style="font-size: 16px; font-weight: 600; margin-bottom: 2px;">选择模式</div>
                        <div style="font-size: 11px; opacity: 0.9; font-weight: 300;">Element2Prompt</div>
                    </div>
                    <button id="exitSelectMode" style="background: rgba(255, 255, 255, 0.2); color: white; border: 1px solid rgba(255, 255, 255, 0.3); padding: 6px 12px; font-size: 12px; border-radius: 6px; cursor: pointer; transition: all 0.2s; font-weight: 500;" onmouseover="this.style.background='rgba(255, 255, 255, 0.3)'; this.style.borderColor='rgba(255, 255, 255, 0.5)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.2)'; this.style.borderColor='rgba(255, 255, 255, 0.3)'">
                        退出
                    </button>
                </div>
                <div style="padding: 16px 20px;">
                    <div id="selectionInfo" style="font-size: 13px; color: #666; margin-bottom: 12px; padding: 12px; background: #f8f9fa; border-radius: 8px; border-left: 3px solid #667eea;">
                        请选择页面元素
                    </div>
                    <div style="margin-bottom: 12px;">
                        <div style="font-size: 13px; font-weight: 600; color: #333; margin-bottom: 8px;">自定义指令 <span style="color: #f5576c; font-size: 13px;">*</span> <span style="font-weight: 400; color: #999; font-size: 11px;">(必填)</span></div>
                        <textarea id="userInstruction" placeholder="例如：修改字体颜色为红色&#10;例如：在这个元素下方新增一个表格&#10;例如：这个组件的宽度改为自适应" style="width: 100%; min-height: 80px; padding: 10px; border: 2px solid #e0e0e0; border-radius: 8px; resize: vertical; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', Roboto, sans-serif; font-size: 13px; line-height: 1.5; transition: all 0.3s; background: #fafafa; box-sizing: border-box;" onfocus="this.style.borderColor='#667eea'; this.style.background='white'; this.style.boxShadow='0 0 0 3px rgba(102, 126, 234, 0.1)'; const errorEl = document.getElementById('userInstructionError'); if(errorEl) errorEl.style.display='none'; const hintEl = document.getElementById('userInstructionHint'); if(hintEl) hintEl.style.display='block';" onblur="this.style.borderColor='#e0e0e0'; this.style.background='#fafafa'; this.style.boxShadow='none'" oninput="if(this.value.trim()) { this.style.borderColor='#667eea'; const errorEl = document.getElementById('userInstructionError'); if(errorEl) errorEl.style.display='none'; const hintEl = document.getElementById('userInstructionHint'); if(hintEl) hintEl.style.display='block'; }"></textarea>
                        <div id="userInstructionError" style="font-size: 11px; color: #f5576c; margin-top: 4px; display: none;">请输入自定义指令</div>
                        <div id="userInstructionHint" style="font-size: 11px; color: #999; margin-top: 4px;">输入你的修改需求，这些内容将添加到提示词中</div>
                    </div>
                    <div style="margin-bottom: 12px;">
                        <div style="font-size: 13px; font-weight: 600; color: #333; margin-bottom: 8px;">Prompt 预览</div>
                        <div id="clipboardContent" style="display: none; max-height: 200px; overflow-y: auto; font-size: 12px; background: #fafafa; padding: 12px; border-radius: 8px; border: 1px solid #e0e0e0; word-break: break-all; white-space: pre-wrap; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace; line-height: 1.6;">
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px; margin-top: 16px;">
                        <button id="confirmSelection" disabled style="flex: 1; padding: 10px 16px; font-size: 13px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 500; transition: all 0.3s; opacity: 0.5; pointer-events: none;">
                            确认选中
                        </button>
                        <button id="clearSelection" disabled style="flex: 1; padding: 10px 16px; font-size: 13px; background: #f5f5f5; color: #666; border: 1px solid #e0e0e0; border-radius: 8px; cursor: pointer; font-weight: 500; transition: all 0.3s; opacity: 0.5; pointer-events: none;">
                            清除
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(this.toolbar);
            console.log('[Content] Toolbar created and added to DOM');
            
            // 恢复toolbar位置
            this.restoreToolbarPosition();
            
            // 设置拖拽功能
            this.setupToolbarDrag();
            
            // 绑定工具栏事件
            this.toolbar.querySelector('#exitSelectMode').addEventListener('click', (e) => {
                e.stopPropagation(); // 防止触发拖拽
                console.log('[Content] Exit button clicked in toolbar');
                // 直接调用退出方法，因为toolbar在content script中
                this.exitSelectMode();
                // 同时通知popup更新状态
                chrome.runtime.sendMessage({ action: 'exitSelectMode' }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.log('[Content] 通知background退出选择模式:', chrome.runtime.lastError.message);
                    }
                });
            });
            
            this.toolbar.querySelector('#confirmSelection').addEventListener('click', () => {
                console.log('[Content] Confirm button clicked in toolbar');
                this.confirmSelection();
            });
            
            this.toolbar.querySelector('#clearSelection').addEventListener('click', () => {
                console.log('[Content] Clear button clicked in toolbar');
                this.clearSelection();
            });
        }).catch(error => {
            console.error('[Content] 创建toolbar失败:', error);
        });
    }
    
    setupToolbarDrag() {
        if (!this.toolbar) return;
        
        const header = this.toolbar.querySelector('#toolbarHeader');
        if (!header) return;
        
        // 鼠标移动事件（在document上监听，确保即使鼠标移出toolbar也能继续拖拽）
        const handleMouseMove = (e) => {
            if (!this.isDragging) return;
            
            // 计算新位置
            const newLeft = e.clientX - this.dragOffset.x;
            const newTop = e.clientY - this.dragOffset.y;
            
            // 限制在视口内
            const maxLeft = window.innerWidth - this.toolbar.offsetWidth;
            const maxTop = window.innerHeight - this.toolbar.offsetHeight;
            
            const clampedLeft = Math.max(0, Math.min(newLeft, maxLeft));
            const clampedTop = Math.max(0, Math.min(newTop, maxTop));
            
            // 更新位置
            this.toolbar.style.left = clampedLeft + 'px';
            this.toolbar.style.top = clampedTop + 'px';
            this.toolbar.style.right = 'auto';
            this.toolbar.style.bottom = 'auto';
        };
        
        // 鼠标释放事件
        const handleMouseUp = () => {
            if (!this.isDragging) return;
            
            this.isDragging = false;
            
            // 恢复样式
            this.toolbar.style.transition = ''; // 恢复过渡动画
            header.style.cursor = 'move';
            header.style.opacity = '1';
            
            // 保存位置
            this.saveToolbarPosition();
            
            // 移除事件监听器
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
        
        // 鼠标按下事件
        header.addEventListener('mousedown', (e) => {
            // 如果点击的是退出按钮，不触发拖拽
            if (e.target.id === 'exitSelectMode' || e.target.closest('#exitSelectMode')) {
                return;
            }
            
            this.isDragging = true;
            
            // 计算鼠标相对于toolbar的偏移量
            const toolbarRect = this.toolbar.getBoundingClientRect();
            this.dragOffset.x = e.clientX - toolbarRect.left;
            this.dragOffset.y = e.clientY - toolbarRect.top;
            
            // 添加拖拽样式
            this.toolbar.style.transition = 'none'; // 拖拽时禁用过渡动画
            header.style.cursor = 'grabbing';
            header.style.opacity = '0.9';
            
            // 在document上监听mousemove和mouseup
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp, { once: true });
            
            // 阻止默认行为
            e.preventDefault();
        });
    }
    
    saveToolbarPosition() {
        if (!this.toolbar) return;
        
        const rect = this.toolbar.getBoundingClientRect();
        const position = {
            left: rect.left,
            top: rect.top
        };
        
        // 保存到chrome storage
        chrome.storage.local.set({ toolbarPosition: position }, () => {
            console.log('[Content] Toolbar position saved:', position);
        });
    }
    
    restoreToolbarPosition() {
        if (!this.toolbar) return;
        
        // 从chrome storage恢复位置
        chrome.storage.local.get(['toolbarPosition'], (result) => {
            if (result.toolbarPosition) {
                const { left, top } = result.toolbarPosition;
                
                // 验证位置是否在视口内
                const maxLeft = window.innerWidth - this.toolbar.offsetWidth;
                const maxTop = window.innerHeight - this.toolbar.offsetHeight;
                
                const clampedLeft = Math.max(0, Math.min(left, maxLeft));
                const clampedTop = Math.max(0, Math.min(top, maxTop));
                
                this.toolbar.style.left = clampedLeft + 'px';
                this.toolbar.style.top = clampedTop + 'px';
                this.toolbar.style.right = 'auto';
                this.toolbar.style.bottom = 'auto';
                
                console.log('[Content] Toolbar position restored:', { left: clampedLeft, top: clampedTop });
            }
        });
        
        // 监听窗口大小变化，确保toolbar始终在视口内
        if (!this.toolbarResizeHandler) {
            this.toolbarResizeHandler = () => {
                if (!this.toolbar || this.isDragging) return;
                
                const rect = this.toolbar.getBoundingClientRect();
                const maxLeft = window.innerWidth - this.toolbar.offsetWidth;
                const maxTop = window.innerHeight - this.toolbar.offsetHeight;
                
                let needsAdjustment = false;
                let newLeft = rect.left;
                let newTop = rect.top;
                
                if (rect.left < 0) {
                    newLeft = 0;
                    needsAdjustment = true;
                } else if (rect.left > maxLeft) {
                    newLeft = maxLeft;
                    needsAdjustment = true;
                }
                
                if (rect.top < 0) {
                    newTop = 0;
                    needsAdjustment = true;
                } else if (rect.top > maxTop) {
                    newTop = maxTop;
                    needsAdjustment = true;
                }
                
                if (needsAdjustment) {
                    this.toolbar.style.left = newLeft + 'px';
                    this.toolbar.style.top = newTop + 'px';
                    this.saveToolbarPosition();
                }
            };
            
            window.addEventListener('resize', this.toolbarResizeHandler);
        }
    }
    
    removeToolbar() {
        if (this.toolbar) {
            console.log('[Content] Removing toolbar');
            // 保存位置后再移除
            this.saveToolbarPosition();
            
            // 移除窗口resize监听器
            if (this.toolbarResizeHandler) {
                window.removeEventListener('resize', this.toolbarResizeHandler);
                this.toolbarResizeHandler = null;
            }
            
            this.toolbar.remove();
            this.toolbar = null;
            this.isDragging = false; // 重置拖拽状态
            console.log('[Content] Toolbar removed');
        }
    }
    
    setupElementSelection() {
        console.log('[Content] Setting up element selection');
        // 添加鼠标移动监听
        document.addEventListener('mousemove', this.handleMouseMove.bind(this));
        
        // 添加点击监听
        document.addEventListener('click', this.handleElementClick.bind(this), true);
        
        // 添加样式
        this.addHighlightStyles();
        console.log('[Content] Element selection setup complete');
    }
    
    cleanupElementSelection() {
        console.log('[Content] Cleaning up element selection');
        document.removeEventListener('mousemove', this.handleMouseMove.bind(this));
        document.removeEventListener('click', this.handleElementClick.bind(this), true);
        
        // 清除高亮
        if (this.selectedElement) {
            this.selectedElement.classList.remove('element2prompt-highlight');
        }
        this.removeHighlightOverlay();
        this.selectedElement = null;
        this.isSelectionLocked = false; // 解除锁定
        console.log('[Content] Element selection cleanup complete');
    }
    
    handleMouseMove(e) {
        if (!this.isSelectMode) return;
        
        // 如果选中已锁定，不再响应鼠标移动
        if (this.isSelectionLocked) return;
        
        const element = e.target;
        
        // 忽略toolbar及其子元素
        if (this.toolbar && (element === this.toolbar || this.toolbar.contains(element))) {
            return;
        }
        
        // 忽略覆盖层本身
        if (this.highlightOverlay && (element === this.highlightOverlay || this.highlightOverlay.contains(element))) {
            return;
        }
        
        // 清除之前的高亮（如果之前有未锁定的选中）
        if (this.selectedElement && this.selectedElement !== element && !this.isSelectionLocked) {
            this.selectedElement.classList.remove('element2prompt-highlight');
        }
        
        // 高亮当前元素（仅在未锁定时）
        if (!this.isSelectionLocked) {
            // 清除之前的高亮类
            if (this.selectedElement && this.selectedElement !== element) {
                this.selectedElement.classList.remove('element2prompt-highlight');
            }
            element.classList.add('element2prompt-highlight');
            this.selectedElement = element;
            
            // 更新选中框覆盖层
            this.updateHighlightOverlay(element);
            
            // 更新工具栏信息
            this.updateSelectionInfo(element);
        }
    }
    
    handleElementClick(e) {
        if (!this.isSelectMode) return;
        
        const element = e.target;
        
        // 忽略toolbar及其子元素
        if (this.toolbar && (element === this.toolbar || this.toolbar.contains(element))) {
            return;
        }
        
        // 忽略覆盖层本身
        if (this.highlightOverlay && (element === this.highlightOverlay || this.highlightOverlay.contains(element))) {
            return;
        }
        
        e.preventDefault();
        e.stopPropagation();
        
        // 锁定选中
        this.selectedElement = element;
        this.isSelectionLocked = true;
        
        // 确保选中元素有高亮样式
        element.classList.add('element2prompt-highlight');
        
        // 更新选中框覆盖层
        this.updateHighlightOverlay(element);
        
        // 更新工具栏信息
        this.updateSelectionInfo(this.selectedElement);
        
        // 启用确认按钮
        const confirmBtn = this.toolbar?.querySelector('#confirmSelection');
        const clearBtn = this.toolbar?.querySelector('#clearSelection');
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.style.opacity = '1';
            confirmBtn.style.pointerEvents = 'auto';
            confirmBtn.style.cursor = 'pointer';
        }
        if (clearBtn) {
            clearBtn.disabled = false;
            clearBtn.style.opacity = '1';
            clearBtn.style.pointerEvents = 'auto';
            clearBtn.style.cursor = 'pointer';
        }
        
        console.log('[Content] 元素已锁定选中:', element);
        
        return false;
    }
    
    updateSelectionInfo(element) {
        if (!this.toolbar) return;
        
        const infoElement = this.toolbar.querySelector('#selectionInfo');
        if (!infoElement) return;
        
        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        
        // 安全获取className，处理SVG元素的SVGAnimatedString
        let classNameStr = '';
        if (element.className) {
            if (typeof element.className === 'string') {
                classNameStr = element.className;
            } else if (element.className.baseVal) {
                // SVG元素的className是SVGAnimatedString对象
                classNameStr = element.className.baseVal;
            } else if (element.className.toString) {
                classNameStr = element.className.toString();
            }
        }
        const classes = classNameStr ? `.${classNameStr.split(' ').filter(c => c).join('.')}` : '';
        
        infoElement.textContent = `${tagName}${id}${classes}`;
    }
    
    addHighlightStyles() {
        // 检查是否已添加样式
        if (document.getElementById('element-highlight-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'element-highlight-styles';
        style.textContent = `
            *:hover {
                cursor: pointer !important;
            }
            .element2prompt-highlight {
                /* 保留一个轻微的视觉提示，但主要使用覆盖层 */
                position: relative;
            }
            #element2prompt-highlight-overlay {
                position: fixed;
                pointer-events: none;
                z-index: 2147483646;
                border: 3px solid #667eea;
                box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2), 
                            0 0 0 5px rgba(102, 126, 234, 0.1),
                            0 4px 12px rgba(0, 0, 0, 0.15);
                border-radius: 2px;
                transition: opacity 0.2s ease;
                box-sizing: border-box;
            }
        `;
        document.head.appendChild(style);
    }
    
    updateHighlightOverlay(element) {
        if (!element) {
            this.removeHighlightOverlay();
            return;
        }
        
        try {
            const rect = element.getBoundingClientRect();
            
            // 创建或更新覆盖层
            if (!this.highlightOverlay) {
                this.highlightOverlay = document.createElement('div');
                this.highlightOverlay.id = 'element2prompt-highlight-overlay';
                document.body.appendChild(this.highlightOverlay);
            }
            
            // 更新覆盖层位置和大小（使用 fixed 定位，相对于视口）
            this.highlightOverlay.style.left = rect.left + 'px';
            this.highlightOverlay.style.top = rect.top + 'px';
            this.highlightOverlay.style.width = Math.max(0, rect.width) + 'px';
            this.highlightOverlay.style.height = Math.max(0, rect.height) + 'px';
            this.highlightOverlay.style.opacity = '1';
            
            // 监听滚动和窗口大小变化，更新覆盖层位置
            if (!this.overlayUpdateListeners) {
                this.overlayUpdateListeners = {
                    scroll: () => {
                        if (this.selectedElement) {
                            this.updateHighlightOverlay(this.selectedElement);
                        }
                    },
                    resize: () => {
                        if (this.selectedElement) {
                            this.updateHighlightOverlay(this.selectedElement);
                        }
                    }
                };
                window.addEventListener('scroll', this.overlayUpdateListeners.scroll, true);
                window.addEventListener('resize', this.overlayUpdateListeners.resize);
            }
        } catch (error) {
            console.error('[Content] 更新选中框覆盖层失败:', error);
        }
    }
    
    removeHighlightOverlay() {
        if (this.highlightOverlay) {
            this.highlightOverlay.remove();
            this.highlightOverlay = null;
        }
        
        // 移除监听器
        if (this.overlayUpdateListeners) {
            window.removeEventListener('scroll', this.overlayUpdateListeners.scroll, true);
            window.removeEventListener('resize', this.overlayUpdateListeners.resize);
            this.overlayUpdateListeners = null;
        }
    }
    
    clearSelection() {
        if (this.selectedElement) {
            this.selectedElement.classList.remove('element2prompt-highlight');
            this.selectedElement = null;
        }
        
        // 移除选中框覆盖层
        this.removeHighlightOverlay();
        
        // 解除锁定
        this.isSelectionLocked = false;
        
        const infoElement = this.toolbar?.querySelector('#selectionInfo');
        if (infoElement) {
            infoElement.textContent = '请选择页面元素';
        }
        
        // 隐藏剪贴板内容
        const clipboardElement = this.toolbar?.querySelector('#clipboardContent');
        if (clipboardElement) {
            clipboardElement.style.display = 'none';
            clipboardElement.textContent = '';
        }
        
        // 清空用户指令输入
        const userInstructionInput = this.toolbar?.querySelector('#userInstruction');
        const errorElement = this.toolbar?.querySelector('#userInstructionError');
        const hintElement = this.toolbar?.querySelector('#userInstructionHint');
        if (userInstructionInput) {
            userInstructionInput.value = '';
            userInstructionInput.style.borderColor = '#e0e0e0';
            userInstructionInput.style.background = '#fafafa';
        }
        if (errorElement) {
            errorElement.style.display = 'none';
        }
        if (hintElement) {
            hintElement.style.display = 'block';
        }
        
        const confirmBtn = this.toolbar?.querySelector('#confirmSelection');
        const clearBtn = this.toolbar?.querySelector('#clearSelection');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.5';
            confirmBtn.style.pointerEvents = 'none';
            confirmBtn.style.cursor = 'not-allowed';
        }
        if (clearBtn) {
            clearBtn.disabled = true;
            clearBtn.style.opacity = '0.5';
            clearBtn.style.pointerEvents = 'none';
            clearBtn.style.cursor = 'not-allowed';
        }
        
        console.log('[Content] 选择已清除，锁定已解除');
    }
    
    async confirmSelection() {
        if (!this.selectedElement) return;
        
        // 验证用户指令是否填写
        const userInstructionInput = this.toolbar?.querySelector('#userInstruction');
        const errorElement = this.toolbar?.querySelector('#userInstructionError');
        const hintElement = this.toolbar?.querySelector('#userInstructionHint');
        
        if (!userInstructionInput || !userInstructionInput.value.trim()) {
            // 显示错误提示
            if (errorElement) {
                errorElement.style.display = 'block';
            }
            if (hintElement) {
                hintElement.style.display = 'none';
            }
            if (userInstructionInput) {
                userInstructionInput.style.borderColor = '#f5576c';
                userInstructionInput.style.background = '#fff5f5';
                // 聚焦到输入框
                userInstructionInput.focus();
                // 添加抖动动画
                userInstructionInput.style.animation = 'shake 0.3s';
                setTimeout(() => {
                    userInstructionInput.style.animation = '';
                }, 300);
            }
            this.showNotification('请填写自定义指令', 'error');
            return;
        }
        
        // 隐藏错误提示，显示提示文字
        if (errorElement) {
            errorElement.style.display = 'none';
        }
        if (hintElement) {
            hintElement.style.display = 'block';
        }
        if (userInstructionInput) {
            userInstructionInput.style.borderColor = '#e0e0e0';
            userInstructionInput.style.background = '#fafafa';
        }
        
        try {
            const elementInfo = await this.getElementInfo();
            
            // 获取用户输入的指令
            elementInfo.userInstruction = userInstructionInput.value.trim();
            
            // 使用Promise包装消息传递
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: 'processElementInfo',
                    elementInfo: elementInfo
                }, (response) => {
                    // 检查是否有错误
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    
                    // 检查响应是否存在
                    if (!response) {
                        reject(new Error('未收到响应'));
                        return;
                    }
                    
                    resolve(response);
                });
            });
            
            if (response.success) {
                const filledTemplate = response.result.template;
                
                // 在content script中复制到剪贴板（因为service worker无法直接访问clipboard）
                try {
                    await this.copyToClipboard(filledTemplate);
                    
                    // 在toolbar中显示剪贴板内容
                    this.displayClipboardContent(filledTemplate);
                    this.showNotification('已复制到剪贴板！');
                } catch (copyError) {
                    console.error('[Content] 复制失败:', copyError);
                    this.showNotification('复制失败: ' + copyError.message, 'error');
                }
            } else {
                const errorMsg = response.error || '未知错误';
                this.showNotification('处理失败: ' + errorMsg, 'error');
            }
            
        } catch (error) {
            console.error('[Content] 确认选中失败:', error);
            this.showNotification('处理失败: ' + error.message, 'error');
        }
    }
    
    async copyToClipboard(text) {
        // 在content script中使用clipboard API复制
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            console.log('[Content] 文本已复制到剪贴板');
        } else {
            // 备用方案：使用execCommand
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-9999px';
            textArea.style.top = '-9999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                
                if (!successful) {
                    throw new Error('execCommand copy 失败');
                }
                console.log('[Content] 使用备用方案复制成功');
            } catch (err) {
                document.body.removeChild(textArea);
                throw new Error('复制到剪贴板失败: ' + err.message);
            }
        }
    }
    
    displayClipboardContent(content) {
        if (!this.toolbar) return;
        
        const clipboardElement = this.toolbar.querySelector('#clipboardContent');
        if (clipboardElement) {
            clipboardElement.textContent = content;
            clipboardElement.style.display = 'block';
            
            // 限制显示长度，如果太长则截断并提示
            if (content.length > 1200) {
                clipboardElement.textContent = content.substring(0, 1200) + '\n\n... (内容已截断，完整内容已复制到剪贴板)';
            }
        }
    }
    
    async getElementInfo() {
        if (!this.selectedElement) {
            throw new Error('未选择元素');
        }
        
        const element = this.selectedElement;
        
        // 安全获取className，处理SVG元素的SVGAnimatedString
        let classNameStr = '';
        if (element.className) {
            if (typeof element.className === 'string') {
                classNameStr = element.className;
            } else if (element.className.baseVal) {
                // SVG元素的className是SVGAnimatedString对象
                classNameStr = element.className.baseVal;
            } else if (element.className.toString) {
                classNameStr = element.className.toString();
            }
        }
        
        return {
            pageUrl: window.location.href,
            html: element.outerHTML,
            css: this.getElementCSS(element),
            domPath: this.getDOMPath(element),
            tagName: element.tagName,
            id: element.id,
            className: classNameStr,
            textContent: element.textContent?.trim() || ''
        };
    }
    
    getElementCSS(element) {
        let css = '';
        
        // 1. 获取元素自身的内联样式
        if (element.style && element.style.length > 0) {
            for (let i = 0; i < element.style.length; i++) {
                const property = element.style[i];
                const value = element.style.getPropertyValue(property);
                if (value) {
                    css += `${property}: ${value};\n`;
                }
            }
        }
        
        // 2. 获取元素自身class和id的样式（从样式表中查找）
        // 遍历所有样式表，查找匹配的规则
        try {
            for (let sheetIndex = 0; sheetIndex < document.styleSheets.length; sheetIndex++) {
                const sheet = document.styleSheets[sheetIndex];
                try {
                    // 跳过跨域样式表
                    if (!sheet.cssRules && !sheet.rules) continue;
                    
                    const rules = sheet.cssRules || sheet.rules;
                    for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
                        const rule = rules[ruleIndex];
                        
                        // 只处理样式规则
                        if (rule.type !== CSSRule.STYLE_RULE && rule.type !== 1) continue;
                        
                        const selector = rule.selectorText;
                        if (!selector) continue;
                        
                        // 检查选择器是否匹配当前元素，且是直接匹配（不包含父元素选择器）
                        try {
                            // 将选择器按逗号分割，检查每个选择器
                            const selectors = selector.split(',').map(s => s.trim());
                            let hasDirectMatch = false;
                            
                            for (const sel of selectors) {
                                // 先检查选择器是否匹配元素（使用浏览器原生方法）
                                let matchesElement = false;
                                try {
                                    matchesElement = element.matches(sel);
                                } catch (e) {
                                    // 选择器可能无效，跳过
                                    continue;
                                }
                                
                                if (matchesElement) {
                                    // 再检查是否是直接匹配（不包含父元素、后代选择器等）
                                    const isDirectMatch = this.isDirectSelectorMatch(element, sel);
                                    
                                    if (isDirectMatch) {
                                        hasDirectMatch = true;
                                        break; // 找到直接匹配就跳出
                                    }
                                }
                            }
                            
                            if (hasDirectMatch) {
                                // 添加匹配的CSS规则
                                css += `/* ${selector} */\n`;
                                if (rule.style) {
                                    for (let i = 0; i < rule.style.length; i++) {
                                        const property = rule.style[i];
                                        const value = rule.style.getPropertyValue(property);
                                        if (value) {
                                            css += `  ${property}: ${value};\n`;
                                        }
                                    }
                                }
                                css += '\n';
                            }
                        } catch (e) {
                            // 选择器可能无效，跳过
                            continue;
                        }
                    }
                } catch (e) {
                    // 跳过无法访问的样式表（可能是跨域）
                    continue;
                }
            }
        } catch (e) {
            console.warn('[Content] 获取样式表规则时出错:', e);
        }
        
        return css.trim();
    }
    
    // 检查选择器是否直接匹配元素（不包含父元素或后代选择器）
    // 注意：这个方法假设 element.matches(selector) 已经返回 true
    isDirectSelectorMatch(element, selector) {
        // 移除伪类和伪元素（保留选择器的主体部分）
        const cleanSelector = selector.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '').trim();
        
        // 如果选择器包含空格、>、+、~ 等组合符，说明不是直接匹配
        // 这些组合符表示父元素、子元素、兄弟元素等关系
        if (/[\s>+~]/.test(cleanSelector)) {
            return false;
        }
        
        // 如果选择器以 :not()、:has() 等伪类开头，可能包含复杂的选择器，需要进一步检查
        // 但我们已经移除了伪类，所以这里主要检查组合符
        
        // 如果选择器不包含组合符，并且 element.matches(selector) 返回 true，
        // 那么基本上就是直接匹配了（可能是 tagName、#id、.className 或其组合）
        // 为了更安全，我们可以进一步验证选择器是否只包含当前元素的属性
        
        // 获取元素信息用于验证
        const tagName = element.tagName.toLowerCase();
        const id = element.id;
        
        // 安全获取className
        let classNameStr = '';
        if (element.className) {
            if (typeof element.className === 'string') {
                classNameStr = element.className;
            } else if (element.className.baseVal) {
                classNameStr = element.className.baseVal;
            } else if (element.className.toString) {
                classNameStr = element.className.toString();
            }
        }
        const classes = classNameStr ? classNameStr.split(' ').filter(c => c.trim()) : [];
        
        // 验证选择器中的class是否都在元素的class列表中
        // 提取选择器中的所有class
        const classSelectors = cleanSelector.match(/\.([a-zA-Z0-9_-]+)/g);
        if (classSelectors) {
            const requiredClasses = classSelectors.map(s => s.substring(1));
            // 检查元素是否包含选择器中的所有class
            const hasAllClasses = requiredClasses.every(cls => classes.includes(cls));
            if (!hasAllClasses) {
                return false; // 选择器中的class不在元素中，不匹配
            }
        }
        
        // 验证选择器中的id是否匹配元素的id
        const idSelectors = cleanSelector.match(/#([a-zA-Z0-9_-]+)/g);
        if (idSelectors) {
            const requiredIds = idSelectors.map(s => s.substring(1));
            // 检查元素id是否匹配选择器中的id
            const hasMatchingId = requiredIds.some(reqId => id === reqId);
            if (!hasMatchingId && idSelectors.length > 0) {
                return false; // 选择器中的id不匹配元素的id
            }
        }
        
        // 如果通过了以上检查，说明是直接匹配
        return true;
    }
    
    getDOMPath(element) {
        const path = [];
        let current = element;
        
        // 从选中元素一直追溯到html根标签
        while (current && current !== document.documentElement) {
            let selector = current.tagName.toLowerCase();
            
            if (current.id) {
                selector += `#${current.id}`;
            } else if (current.className) {
                // 安全获取className，处理SVG元素的SVGAnimatedString
                let classNameStr = '';
                if (typeof current.className === 'string') {
                    classNameStr = current.className;
                } else if (current.className.baseVal) {
                    // SVG元素的className是SVGAnimatedString对象
                    classNameStr = current.className.baseVal;
                } else if (current.className.toString) {
                    classNameStr = current.className.toString();
                }
                
                if (classNameStr) {
                    selector += `.${classNameStr.split(' ').filter(c => c).join('.')}`;
                }
            }
            
            path.unshift(selector);
            current = current.parentElement;
        }
        
        // 添加html根标签
        if (document.documentElement) {
            path.unshift('html');
        }
        
        return path;
    }
    
    showNotification(message, type = 'success') {
        // 创建通知元素
        const notification = document.createElement('div');
        notification.textContent = message;
        
        const bgColor = type === 'success' 
            ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' 
            : 'linear-gradient(135deg, #f5576c 0%, #f093fb 100%)';
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${bgColor};
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', Roboto, 'Helvetica Neue', Arial, sans-serif;
            font-size: 14px;
            font-weight: 500;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
            animation: slideInNotification 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            max-width: 300px;
            word-wrap: break-word;
        `;
        
        // 添加通知动画样式
        if (!document.getElementById('notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                @keyframes slideInNotification {
                    from {
                        opacity: 0;
                        transform: translateX(100px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(notification);
        
        // 2秒后自动消失，带淡出动画
        setTimeout(() => {
            notification.style.transition = 'opacity 0.3s, transform 0.3s';
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(100px)';
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 2000);
    }
}

    // 将类赋值给window对象，以便重复加载时也能访问
    window.ContentExtractor = ContentExtractor;

    // 初始化 - 确保在所有frame中都初始化消息监听器
    console.log('[Content] Initializing ContentExtractor...');
    if (!window.__CONTENT_EXTRACTOR_INSTANCE__) {
        window.__CONTENT_EXTRACTOR_INSTANCE__ = new ContentExtractor();
        
        // 在顶层frame中记录初始化状态
        if (window === window.top) {
            console.log('[Content] Top-level frame ContentExtractor initialized successfully');
        }
    } else {
        console.log('[Content] ContentExtractor instance already exists, reusing existing instance');
        // 如果实例已存在，确保消息监听器已注册
        if (window.__CONTENT_EXTRACTOR_INSTANCE__ && !window.__CONTENT_EXTRACTOR_INSTANCE__.messageListenerRegistered) {
            window.__CONTENT_EXTRACTOR_INSTANCE__.setupMessageListener();
        }
    }
} else {
    // 类已经声明，只确保实例存在
    console.log('[Content] ContentExtractor class already declared, ensuring instance exists');
    if (!window.__CONTENT_EXTRACTOR_INSTANCE__) {
        // 如果类已声明但实例不存在，说明是重复加载，使用已存在的类创建实例
        // 注意：由于类定义在if块内，重复加载时无法访问，所以需要从window获取
        if (window.ContentExtractor) {
            window.__CONTENT_EXTRACTOR_INSTANCE__ = new window.ContentExtractor();
        } else {
            console.warn('[Content] ContentExtractor class not found, script may have been partially loaded');
        }
    } else {
        // 确保消息监听器已注册
        if (!window.__CONTENT_EXTRACTOR_INSTANCE__.messageListenerRegistered) {
            window.__CONTENT_EXTRACTOR_INSTANCE__.setupMessageListener();
        }
    }
}