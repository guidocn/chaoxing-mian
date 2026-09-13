/**
 * 学习通助手 - Web控制台
 * 现代化交互脚本 - 支持多账号
 */

// 全局状态
const AppState = {
    socket: null,
    isProgramRunning: false,
    startTime: null,
    timerInterval: null,
    accounts: [],  // 多账号列表
    stats: {
        courses: 0,
        completed: 0
    }
};

// 工具函数
const Utils = {
    // HTML转义
    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(text).replace(/[&<>"']/g, m => map[m]);
    },

    // 格式化时间
    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) {
            return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    },

    // 解析日志级别
    getLogLevel(text) {
        if (text.includes('[TRACE]')) return 'trace';
        if (text.includes('[DEBUG]')) return 'debug';
        if (text.includes('[INFO]')) return 'info';
        if (text.includes('[WARNING]') || text.includes('[WARN]')) return 'warning';
        if (text.includes('[ERROR]')) return 'error';
        return null;
    },

    // 解析统计信息
    parseStats(text) {
        if (!text.includes('[STATS]')) return null;
        
        const stats = {};
        
        // 解析格式: [STATS] key=value
        const singlePattern = /\[STATS\]\s*(\w+)=(\d+)/;
        const singleMatch = text.match(singlePattern);
        if (singleMatch) {
            stats[singleMatch[1]] = parseInt(singleMatch[2]);
            return stats;
        }
        
        // 解析格式: [STATS] courses=X|completed=Y|total=Z
        const multiPattern = /\[STATS\]\s*courses=(\d+)\|completed=(\d+)\|total=(\d+)/;
        const multiMatch = text.match(multiPattern);
        if (multiMatch) {
            return {
                courses: parseInt(multiMatch[1]),
                completed: parseInt(multiMatch[2]),
                total: parseInt(multiMatch[3])
            };
        }
        
        return null;
    },

    // 防抖
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};

// Toast 通知系统
const Toast = {
    show(message, type = 'info', duration = 4000) {
        const container = document.getElementById('toast-container');
        const id = 'toast-' + Date.now();
        
        const icons = {
            success: 'fa-check-circle',
            danger: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };

        const toast = document.createElement('div');
        toast.id = id;
        toast.className = `toast show align-items-center text-white bg-${type} border-0`;
        toast.setAttribute('role', 'alert');
        toast.innerHTML = `
            <div class="d-flex align-items-center p-3">
                <i class="fas ${icons[type]} me-3 fa-lg"></i>
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white ms-auto" data-bs-dismiss="toast"></button>
            </div>
        `;

        container.appendChild(toast);

        // 自动移除
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, duration);

        // 手动关闭
        toast.querySelector('.btn-close').addEventListener('click', () => {
            toast.style.animation = 'fadeOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        });
    }
};

// 终端管理
const Terminal = {
    element: null,
    outputElement: null,
    
    init() {
        this.element = document.getElementById('terminal');
        this.outputElement = document.getElementById('terminal-output');
    },
    
    append(data) {
        // 移除欢迎信息
        const welcome = this.outputElement.querySelector('.welcome-message');
        if (welcome) welcome.remove();

        const line = document.createElement('div');
        const logLevel = Utils.getLogLevel(data);
        
        if (logLevel) {
            line.className = `log-${logLevel}`;
        }
        
        line.textContent = data;
        this.outputElement.appendChild(line);
        this.scrollToBottom();
        
        // 解析统计信息并更新UI
        const stats = Utils.parseStats(data);
        if (stats) {
            this.updateStatsDisplay(stats);
        }
        
        // 限制行数
        const lines = this.outputElement.children;
        if (lines.length > 500) {
            lines[0].remove();
        }
    },
    
    updateStatsDisplay(stats) {
        if (stats.courses !== undefined) {
            document.getElementById('stat-courses').textContent = stats.courses;
            AppState.stats.courses = stats.courses;
        }
        if (stats.completed !== undefined) {
            document.getElementById('stat-completed').textContent = stats.completed;
            AppState.stats.completed = stats.completed;
        }
        if (stats.total !== undefined) {
            AppState.stats.total = stats.total;
        }
    },
    
    clear() {
        this.outputElement.innerHTML = `
            <div class="welcome-message">
                <div class="welcome-icon"><i class="fas fa-rocket"></i></div>
                <div class="welcome-text">欢迎使用学习通助手</div>
                <div class="welcome-hint">配置完成后点击「启动」按钮开始学习</div>
            </div>
        `;
    },
    
    scrollToBottom() {
        this.element.scrollTop = this.element.scrollHeight;
    },
    
    showWelcome() {
        this.outputElement.innerHTML = `
            <div class="welcome-message">
                <div class="welcome-icon"><i class="fas fa-rocket"></i></div>
                <div class="welcome-text">欢迎使用学习通助手</div>
                <div class="welcome-hint">配置完成后点击「启动」按钮开始学习</div>
            </div>
        `;
    }
};

// 状态管理
const Status = {
    update(running) {
        AppState.isProgramRunning = running;
        
        const statusIndicator = document.getElementById('status-indicator');
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');
        const terminalInput = document.getElementById('terminal-input');
        const sendBtn = document.getElementById('send-btn');

        if (running) {
            statusIndicator.className = 'status-badge status-running';
            statusIndicator.innerHTML = `
                <span class="status-dot"></span>
                <span class="status-text">运行中</span>
            `;
            startBtn.disabled = true;
            stopBtn.disabled = false;
            terminalInput.disabled = false;
            sendBtn.disabled = false;
            
            // 重置统计和时间，然后启动计时器
            this.resetStats();
            this.startTimer();
        } else {
            statusIndicator.className = 'status-badge status-stopped';
            statusIndicator.innerHTML = `
                <span class="status-dot"></span>
                <span class="status-text">未运行</span>
            `;
            startBtn.disabled = false;
            stopBtn.disabled = true;
            terminalInput.disabled = true;
            sendBtn.disabled = true;
            
            // 停止计时器
            this.stopTimer();
        }
    },
    
    resetStats() {
        // 重置统计信息
        AppState.stats = { courses: 0, completed: 0, total: 0 };
        document.getElementById('stat-courses').textContent = '0';
        document.getElementById('stat-completed').textContent = '0';
        document.getElementById('stat-time').textContent = '00:00';
    },
    
    startTimer() {
        // 先停止已有的计时器
        this.stopTimer();
        // 重置开始时间
        AppState.startTime = Date.now();
        AppState.timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - AppState.startTime) / 1000);
            document.getElementById('stat-time').textContent = Utils.formatTime(elapsed);
        }, 1000);
    },
    
    stopTimer() {
        if (AppState.timerInterval) {
            clearInterval(AppState.timerInterval);
            AppState.timerInterval = null;
        }
    }
};

// 配置管理
const Config = {
    async load() {
        try {
            const response = await fetch('/api/config');
            const config = await response.json();
            
            // 加载多账号
            if (config.accounts && config.accounts.length > 0) {
                AppState.accounts = config.accounts.map((acc, idx) => ({
                    id: acc.id || `account_${idx + 1}`,
                    username: acc.username || '',
                    password: acc.password || '',
                    courses: acc.courses || ''
                }));
            } else {
                // 兼容旧配置
                AppState.accounts = [{
                    id: 'account_1',
                    username: config.common?.username || '',
                    password: config.common?.password || '',
                    courses: config.common?.course_list || ''
                }];
            }
            
            this.renderAccounts();
            
            if (config.common) {
                document.getElementById('speed').value = config.common.speed || '2';
                document.getElementById('notopen_action').value = config.common.notopen_action || 'continue';
            }
            
            if (config.tiku) {
                document.getElementById('tiku_provider').value = config.tiku.provider || 'TikuLocal';
                document.getElementById('tiku_submit').value = config.tiku.submit || 'false';
                document.getElementById('tiku_tokens').value = config.tiku.tokens || '';
                document.getElementById('tiku_local_api').value = config.tiku.local_api || config.tiku.url || '';
                this.handleTikuProviderChange(config.tiku.provider || 'TikuLocal');
            }
        } catch (error) {
            console.error('加载配置失败:', error);
            Toast.show('加载配置失败', 'danger');
        }
    },
    
    handleTikuProviderChange(provider) {
        const tokenContainer = document.getElementById('tiku-token-container');
        const apiContainer = document.getElementById('tiku-api-container');
        
        // ZError、本地题库和TikuAdapter显示API地址，其他显示Token
        if (provider === 'TikuLocal' || provider === 'TikuAdapter' || provider === 'TikuZError') {
            tokenContainer.style.display = 'none';
            apiContainer.style.display = 'block';
        } else {
            tokenContainer.style.display = 'block';
            apiContainer.style.display = 'none';
        }
    },
    
    renderAccounts() {
        const container = document.getElementById('accounts-container');
        container.innerHTML = '';
        
        AppState.accounts.forEach((account, index) => {
            const accountDiv = document.createElement('div');
            accountDiv.className = 'account-item mb-3 p-3 border rounded';
            accountDiv.dataset.index = index;
            accountDiv.innerHTML = `
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <span class="badge bg-primary">账号 ${index + 1}</span>
                    ${AppState.accounts.length > 1 ? `
                        <button type="button" class="btn btn-sm btn-outline-danger remove-account-btn" data-index="${index}">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : ''}
                </div>
                <div class="form-floating mb-2">
                    <input type="text" class="form-control form-control-sm account-username" 
                           id="username_${index}" value="${account.username}" placeholder="手机号">
                    <label for="username_${index}"><i class="fas fa-phone me-2"></i>手机号</label>
                </div>
                <div class="form-floating mb-2">
                    <input type="password" class="form-control form-control-sm account-password" 
                           id="password_${index}" value="${account.password}" placeholder="密码">
                    <label for="password_${index}"><i class="fas fa-lock me-2"></i>密码</label>
                </div>
                <div class="form-floating">
                    <input type="text" class="form-control form-control-sm account-courses" 
                           id="courses_${index}" value="${account.courses || ''}" placeholder="课程ID">
                    <label for="courses_${index}"><i class="fas fa-book me-2"></i>课程ID（留空需在控制台输入）</label>
                </div>
            `;
            container.appendChild(accountDiv);
        });
        
        // 绑定删除账号事件
        container.querySelectorAll('.remove-account-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index);
                AppState.accounts.splice(idx, 1);
                this.renderAccounts();
            });
        });
    },
    
    addAccount() {
        AppState.accounts.push({
            id: `account_${AppState.accounts.length + 1}`,
            username: '',
            password: '',
            courses: ''
        });
        this.renderAccounts();
    },
    
    async save() {
        // 收集账号数据
        const accountsData = [];
        document.querySelectorAll('#accounts-container .account-item').forEach((item, idx) => {
            accountsData.push({
                username: item.querySelector('.account-username').value,
                password: item.querySelector('.account-password').value,
                courses: item.querySelector('.account-courses').value
            });
        });
        
        const tikuProvider = document.getElementById('tiku_provider').value;
        const tikuConfig = {
            provider: tikuProvider,
            submit: document.getElementById('tiku_submit').value,
        };
        
        // 根据题库类型保存不同配置
        if (tikuProvider === 'TikuLocal' || tikuProvider === 'TikuAdapter' || tikuProvider === 'TikuZError') {
            tikuConfig.local_api = document.getElementById('tiku_local_api').value;
            tikuConfig.url = document.getElementById('tiku_local_api').value; // 兼容旧字段
        } else {
            tikuConfig.tokens = document.getElementById('tiku_tokens').value;
        }
        
        const config = {
            accounts: accountsData,
            common: {
                speed: document.getElementById('speed').value,
                notopen_action: document.getElementById('notopen_action').value
            },
            tiku: tikuConfig
        };
        
        try {
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            
            const result = await response.json();
            
            if (result.success) {
                Toast.show('配置保存成功', 'success');
            } else {
                Toast.show('配置保存失败: ' + (result.error || '未知错误'), 'danger');
            }
        } catch (error) {
            console.error('保存配置失败:', error);
            Toast.show('保存配置失败', 'danger');
        }
    },
    
    async testTikuConnection() {
        const provider = document.getElementById('tiku_provider').value;
        const tikuConfig = {
            provider: provider,
            submit: document.getElementById('tiku_submit').value,
        };
        
        // 根据题库类型收集配置
        if (provider === 'TikuLocal' || provider === 'TikuAdapter' || provider === 'TikuZError') {
            tikuConfig.local_api = document.getElementById('tiku_local_api').value;
            tikuConfig.url = document.getElementById('tiku_local_api').value;
        } else if (provider === 'TikuYanxi' || provider === 'TikuLike') {
            tikuConfig.tokens = document.getElementById('tiku_tokens').value;
        } else if (provider === 'AI') {
            tikuConfig.endpoint = document.getElementById('tiku_endpoint')?.value || '';
            tikuConfig.key = document.getElementById('tiku_key')?.value || '';
            tikuConfig.model = document.getElementById('tiku_model')?.value || '';
        } else if (provider === 'SiliconFlow') {
            tikuConfig.siliconflow_key = document.getElementById('siliconflow_key')?.value || '';
            tikuConfig.siliconflow_model = document.getElementById('siliconflow_model')?.value || '';
            tikuConfig.siliconflow_endpoint = document.getElementById('siliconflow_endpoint')?.value || '';
        }
        
        // 显示测试中状态
        const testBtn = document.getElementById('test-tiku-btn');
        const resultDiv = document.getElementById('tiku-test-result');
        const messageSpan = document.getElementById('tiku-test-message');
        
        testBtn.disabled = true;
        testBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>测试中...';
        resultDiv.style.display = 'block';
        resultDiv.querySelector('.alert').className = 'alert alert-info mb-0';
        messageSpan.textContent = '正在连接题库...';
        
        try {
            const response = await fetch('/api/test-tiku', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: provider,
                    config: tikuConfig
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                resultDiv.querySelector('.alert').className = 'alert alert-success mb-0';
                messageSpan.innerHTML = `<i class="fas fa-check-circle me-2"></i>${result.message}`;
            } else {
                resultDiv.querySelector('.alert').className = 'alert alert-danger mb-0';
                messageSpan.innerHTML = `<i class="fas fa-times-circle me-2"></i>${result.message}`;
            }
        } catch (error) {
            resultDiv.querySelector('.alert').className = 'alert alert-danger mb-0';
            messageSpan.innerHTML = `<i class="fas fa-times-circle me-2"></i>测试失败: ${error.message}`;
        } finally {
            testBtn.disabled = false;
            testBtn.innerHTML = '<i class="fas fa-plug me-2"></i>测试题库连接';
        }
    }
};

// 程序控制
const Program = {
    async start() {
        try {
            const response = await fetch('/api/start', { method: 'POST' });
            const result = await response.json();
            
            if (result.success) {
                Status.update(true);
                Toast.show('程序启动成功', 'success');
            } else {
                Toast.show('启动失败: ' + (result.error || '未知错误'), 'danger');
            }
        } catch (error) {
            console.error('启动程序失败:', error);
            Toast.show('启动程序失败', 'danger');
        }
    },
    
    async stop() {
        try {
            const response = await fetch('/api/stop', { method: 'POST' });
            const result = await response.json();
            
            if (result.success) {
                Status.update(false);
                Toast.show('程序已停止', 'info');
            } else {
                Toast.show('停止失败: ' + (result.error || '未知错误'), 'danger');
            }
        } catch (error) {
            console.error('停止程序失败:', error);
            Toast.show('停止程序失败', 'danger');
        }
    },
    
    async sendInput(text) {
        if (!text || !AppState.isProgramRunning) return;
        
        try {
            const response = await fetch('/api/send-input', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: text })
            });
            
            const result = await response.json();
            
            if (result.success) {
                Terminal.append(`> ${text}`);
                return true;
            } else {
                Toast.show('发送失败: ' + (result.error || '未知错误'), 'danger');
                return false;
            }
        } catch (error) {
            console.error('发送输入失败:', error);
            Toast.show('发送输入失败', 'danger');
            return false;
        }
    }
};

// Socket 连接
const Socket = {
    init() {
        AppState.socket = io();
        
        AppState.socket.on('connect', () => {
            console.log('WebSocket 连接成功');
            this.loadStatus();
        });
        
        AppState.socket.on('disconnect', () => {
            console.log('WebSocket 连接断开');
            Toast.show('连接断开，正在重连...', 'warning');
        });
        
        AppState.socket.on('status', (data) => {
            Status.update(data.running);
        });
        
        AppState.socket.on('output', (data) => {
            Terminal.append(data.data);
        });
    },
    
    async loadStatus() {
        try {
            const response = await fetch('/api/status');
            const status = await response.json();
            Status.update(status.running);
            
            // 加载历史输出
            if (status.output && status.output.length > 0) {
                Terminal.outputElement.innerHTML = '';
                status.output.forEach(line => {
                    Terminal.append(line);
                });
            }
        } catch (error) {
            console.error('获取状态失败:', error);
        }
    }
};

// 事件监听器设置
function setupEventListeners() {
    // 配置表单提交
    document.getElementById('config-form').addEventListener('submit', (e) => {
        e.preventDefault();
        Config.save();
    });
    
    // 添加账号按钮
    document.getElementById('add-account-btn').addEventListener('click', () => {
        Config.addAccount();
    });
    
    // 题库选择器变化
    document.getElementById('tiku_provider').addEventListener('change', (e) => {
        Config.handleTikuProviderChange(e.target.value);
    });
    
    // 测试题库连接按钮
    document.getElementById('test-tiku-btn').addEventListener('click', () => {
        Config.testTikuConnection();
    });
    
    // 启动按钮
    document.getElementById('start-btn').addEventListener('click', Program.start);
    
    // 停止按钮
    document.getElementById('stop-btn').addEventListener('click', Program.stop);
    
    // 清空按钮
    document.getElementById('clear-btn').addEventListener('click', () => Terminal.clear());
    
    // 发送按钮
    document.getElementById('send-btn').addEventListener('click', () => {
        const input = document.getElementById('terminal-input');
        const text = input.value.trim();
        if (text) {
            Program.sendInput(text);
            input.value = '';
        }
    });
    
    // 终端输入框回车
    document.getElementById('terminal-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const text = e.target.value.trim();
            if (text) {
                Program.sendInput(text);
                e.target.value = '';
            }
        }
    });
    
    // 快捷操作按钮
    document.querySelectorAll('.btn-quick').forEach(button => {
        button.addEventListener('click', function() {
            const action = this.getAttribute('data-action');
            handleQuickAction(action);
        });
    });
    
    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
        // Ctrl + Enter 启动/停止
        if (e.ctrlKey && e.key === 'Enter') {
            if (AppState.isProgramRunning) {
                Program.stop();
            } else {
                Program.start();
            }
        }
        
        // Ctrl + L 清空终端
        if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            Terminal.clear();
        }
    });
}

// 快捷操作处理
function handleQuickAction(action) {
    if (!AppState.isProgramRunning) {
        Toast.show('请先启动程序', 'warning');
        return;
    }
    
    const actions = {
        'login': '1',
        'courses': '2',
        'progress': '3',
        'status': '4'
    };
    
    if (actions[action]) {
        Program.sendInput(actions[action]);
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    Terminal.init();
    Socket.init();
    Config.load();
    setupEventListeners();
    
    // 添加键盘焦点提示
    const terminalInput = document.getElementById('terminal-input');
    terminalInput.addEventListener('focus', () => {
        terminalInput.parentElement.style.boxShadow = '0 0 0 2px rgba(102, 126, 234, 0.3)';
    });
    terminalInput.addEventListener('blur', () => {
        terminalInput.parentElement.style.boxShadow = '';
    });
});

// 页面可见性变化时重连
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && AppState.socket) {
        if (!AppState.socket.connected) {
            AppState.socket.connect();
        }
    }
});

// 添加淡出动画
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeOut {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(100%); }
    }
`;
document.head.appendChild(style);
