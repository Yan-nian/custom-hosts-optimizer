import { Hono } from "hono"
import { basicAuth } from "hono/basic-auth"
import {
  formatHostsFile,
  getDomainData,
  getCompleteHostsData,
  getHostsData,
  resetHostsData,
  getCustomDomains,
  addCustomDomain,
  removeCustomDomain,
  fetchCustomDomainsData,
  fetchLatestHostsData,
  fetchIPFromMultipleDNS,
  storeData,
  type HostEntry,
} from "./services/hosts"
import { handleSchedule } from "./scheduled"
import { Bindings } from "./types"

const app = new Hono<{ Bindings: Bindings }>()

// API 验证中间件 - 使用后台地址作为验证
const apiAuth = async (c: any, next: any) => {
  const path = c.req.path
  
  // 需要验证的 API 路径（管理类 API）
  const protectedPaths = [
    '/api/custom-domains',
    '/api/optimize-all', 
    '/api/optimize/',
    '/api/reset',
    '/api/cache/refresh',
    '/api/cache',
    '/api/system/' // 系统配置 API 也需要验证
  ]
  
  // 主页刷新功能允许访问的API（限制权限）
  const mainPageAllowedPaths = [
    '/api/optimize-all',
    '/api/cache/refresh'
  ]
  
  // 检查是否是需要保护的 API
  const isProtectedAPI = protectedPaths.some(protectedPath => 
    path.startsWith(protectedPath) && 
    (c.req.method === 'POST' || c.req.method === 'DELETE' || c.req.method === 'PUT' || 
     (path.startsWith('/api/system/') && c.req.method === 'GET')) // 系统配置的 GET 也需要验证
  )
  
  if (isProtectedAPI) {
    // 获取系统配置
    const systemConfig = await c.env.custom_hosts.get("system_config", {
      type: "json",
    }) as any || {}
    
    const configuredAdminPath = systemConfig.adminPath || "/admin-x7k9m3q2"
    const configuredApiKey = systemConfig.apiKey || c.env.API_KEY
    
    // 检查 Referer 头，确保请求来自管理后台
    const referer = c.req.header('referer') || c.req.header('Referer')
    const origin = c.req.header('origin') || c.req.header('Origin')
    
    // 获取当前域名
    const host = c.req.header('host')
    
    // 验证请求来源 - 使用配置的管理后台地址
    const isValidReferer = referer && referer.includes(configuredAdminPath)
    const isValidOrigin = origin && host && origin.includes(host)
    
    // API Key 验证（包括特殊的主页刷新Key）
    const apiKey = c.req.header('x-api-key') || c.req.query('key')
    const isValidApiKey = !configuredApiKey || apiKey === configuredApiKey
    
    // 特殊处理：主页刷新专用API Key，只允许访问特定的API
    const isMainPageRefreshKey = apiKey === 'main-page-refresh'
    const isMainPageAllowedAPI = mainPageAllowedPaths.some(allowedPath => 
      path.startsWith(allowedPath)
    )
    
    // 验证逻辑
    if (isMainPageRefreshKey) {
      // 主页刷新Key只能访问指定的API
      if (!isMainPageAllowedAPI) {
        console.log(`主页刷新Key访问被拒绝: ${path} - 不在允许的API列表中`)
        return c.json({ 
          error: 'Access denied. Main page refresh key can only access optimization and cache refresh APIs.',
          code: 'LIMITED_ACCESS_KEY',
          allowedApis: mainPageAllowedPaths
        }, 403)
      }
      console.log(`主页刷新Key访问已验证: ${path}`)
    } else if (!isValidReferer && !isValidApiKey) {
      console.log(`API 访问被拒绝: ${path}, referer: ${referer}, expected admin path: ${configuredAdminPath}`)
      return c.json({ 
        error: 'Access denied. Please use the admin panel to manage APIs.',
        code: 'ADMIN_ACCESS_REQUIRED',
        hint: `Visit ${configuredAdminPath} to access management features`,
        adminPath: configuredAdminPath
      }, 403)
    } else {
      console.log(`API 访问已验证: ${path}`)
    }
  }
  
  return await next()
}

// 管理员认证中间件 - 使用URL参数验证
const adminAuth = async (c: any, next: any) => {
  // 直接通过认证，不需要账号密码
  return await next();
}

// 管理后台路由组
const admin = new Hono<{ Bindings: Bindings }>()

// 应用 API 验证中间件到所有路由
app.use('*', apiAuth)

// 首页路由
app.get("/", async (c) => {
  try {
    const html = await c.env.ASSETS.get("index.html")
    if (!html) {
      return c.text("Template not found", 404)
    }
    return c.html(html)
  } catch (error) {
    console.error("Error loading index.html:", error)
    return c.html(`
<!DOCTYPE html>
<html>
<head><title>Custom Hosts</title></head>
<body>
<h1>Custom Hosts Service</h1>
<p>Service is running. Visit /admin-x7k9m3q2 for management.</p>
<p>Error loading assets: ${error instanceof Error ? error.message : String(error)}</p>
</body>
</html>
    `)
  }
})

// 管理后台主页
admin.get("/", async (c) => {
  const adminHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>自定义域名管理后台</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        .container { 
            max-width: 1400px; 
            margin: 0 auto; 
            padding: 20px; 
        }
        .header { 
            background: rgba(255,255,255,0.95); 
            padding: 30px; 
            border-radius: 16px; 
            margin-bottom: 24px; 
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
            text-align: center;
        }
        .header h1 { 
            color: #2d3748; 
            margin-bottom: 8px; 
            font-size: 2.2rem;
            font-weight: 700;
        }
        .header p { 
            color: #718096; 
            font-size: 1.1rem;
        }
        .card { 
            background: rgba(255,255,255,0.95); 
            padding: 24px; 
            border-radius: 16px; 
            margin-bottom: 24px; 
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.2);
        }
        .card h3 {
            color: #2d3748;
            margin-bottom: 20px;
            font-size: 1.3rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .form-group { margin-bottom: 16px; }
        .form-group label { 
            display: block; 
            margin-bottom: 6px; 
            font-weight: 600; 
            color: #4a5568;
            font-size: 0.95rem;
        }
        .form-group textarea { 
            width: 100%; 
            padding: 12px 16px; 
            border: 2px solid #e2e8f0; 
            border-radius: 12px; 
            font-size: 14px; 
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
            transition: all 0.2s ease;
            resize: vertical;
            line-height: 1.5;
        }
        .form-group textarea:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        .btn { 
            padding: 12px 24px; 
            border: none; 
            border-radius: 12px; 
            cursor: pointer; 
            font-size: 14px; 
            font-weight: 600;
            margin-right: 12px; 
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        .btn-primary { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; 
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }
        .btn-primary:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
        }
        .btn-danger { 
            background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%); 
            color: white; 
            box-shadow: 0 4px 15px rgba(255, 107, 107, 0.4);
        }
        .btn-danger:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 6px 20px rgba(255, 107, 107, 0.6);
        }
        .btn-success { 
            background: linear-gradient(135deg, #51cf66 0%, #40c057 100%); 
            color: white; 
            box-shadow: 0 4px 15px rgba(81, 207, 102, 0.4);
        }
        .btn-success:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 6px 20px rgba(81, 207, 102, 0.6);
        }
        .btn-info {
            background: linear-gradient(135deg, #339af0 0%, #228be6 100%);
            color: white;
            box-shadow: 0 4px 15px rgba(51, 154, 240, 0.4);
        }
        .btn-info:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(51, 154, 240, 0.6);
        }
        .domain-list { 
            max-height: 500px; 
            overflow-y: auto; 
            background: #f8fafc;
            border-radius: 12px;
            padding: 16px;
        }
        .domain-item { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            padding: 16px; 
            background: white;
            border-radius: 12px;
            margin-bottom: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
            transition: all 0.2s ease;
        }
        .domain-item:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .domain-info { flex: 1; }
        .domain-info strong {
            color: #2d3748;
            font-size: 1.1rem;
        }
        .domain-info small {
            color: #718096;
            font-size: 0.85rem;
        }
        .domain-actions { 
            display: flex; 
            gap: 8px; 
        }
        .stats { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
            gap: 20px; 
            margin-bottom: 24px; 
        }
        .stat-card { 
            background: rgba(255,255,255,0.95); 
            padding: 24px; 
            border-radius: 16px; 
            text-align: center; 
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.2);
            transition: all 0.2s ease;
        }
        .stat-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 12px 40px rgba(0,0,0,0.15);
        }
        .stat-number { 
            font-size: 2.5em; 
            font-weight: 700; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .stat-label { 
            color: #718096; 
            margin-top: 8px; 
            font-weight: 500;
        }
        .alert { 
            padding: 16px 20px; 
            margin-bottom: 20px; 
            border-radius: 12px; 
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .alert-success { 
            background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%); 
            color: #155724; 
            border: 1px solid #c3e6cb; 
        }
        .alert-error { 
            background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%); 
            color: #721c24; 
            border: 1px solid #f5c6cb; 
        }
        .batch-input { 
            min-height: 120px; 
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
        }
        .debug-section {
            background: #f8fafc;
            border-radius: 12px;
            padding: 20px;
            margin-top: 16px;
        }
        .controls-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
            gap: 12px;
        }
        .controls-left {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }
        @media (max-width: 768px) {
            .container { padding: 16px; }
            .controls-row { flex-direction: column; align-items: stretch; }
            .controls-left { justify-content: center; }
            .stats { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
            .debug-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🛠️ 自定义域名管理后台</h1>
            <p>管理和配置自定义域名，优化访问性能</p>
            <div id="current-admin-path" style="margin-top: 10px; padding: 8px 16px; background: rgba(102, 126, 234, 0.1); border-radius: 8px; font-size: 0.9rem; color: #667eea;">
                <strong>当前管理地址:</strong> <span id="admin-path-display">/admin-x7k9m3q2</span>
            </div>
        </div>

        <div id="alert-container"></div>

        <!-- 统计信息 -->
        <!-- 系统设置 -->
        <div class="card">
            <h3>⚙️ 系统设置</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
                <div>
                    <div class="form-group">
                        <label for="admin-path">管理后台地址:</label>
                        <input type="text" id="admin-path" placeholder="/admin-x7k9m3q2" style="width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px;">
                        <small style="color: #718096;">修改后需要重新部署才能生效</small>
                    </div>
                    <button class="btn btn-info" onclick="updateAdminPath()">🔄 更新后台地址</button>
                </div>
                <div>
                    <div class="form-group">
                        <label for="api-key">API Key:</label>
                        <input type="password" id="api-key" placeholder="输入新的 API Key" style="width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px;">
                        <small style="color: #718096;">用于外部 API 调用验证</small>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-info" onclick="updateApiKey()">🔑 更新 API Key</button>
                        <button class="btn btn-success" onclick="generateApiKey()">🎲 生成随机 Key</button>
                        <button class="btn btn-primary" onclick="showApiKey()">👁️ 显示当前 Key</button>
                    </div>
                </div>
            </div>
        </div>

        <div class="stats">
            <div class="stat-card">
                <div class="stat-number" id="total-domains">-</div>
                <div class="stat-label">总域名数</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="github-domains">-</div>
                <div class="stat-label">GitHub 域名</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="custom-domains">-</div>
                <div class="stat-label">自定义域名</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="resolved-domains">-</div>
                <div class="stat-label">已解析域名</div>
            </div>
        </div>

        <!-- 批量添加域名 -->
        <div class="card">
            <h3>📝 批量管理域名</h3>
            <div class="form-group">
                <label for="batch-domains">域名列表 (每行一个，格式: 域名|描述):</label>
                <textarea id="batch-domains" class="batch-input" placeholder="example1.com|第一个域名&#10;example2.com|第二个域名&#10;example3.com"></textarea>
            </div>
            <button class="btn btn-primary" onclick="batchAddDomains()">📥 批量添加</button>
        </div>

        <!-- 域名列表 -->
        <div class="card">
            <h3>📋 域名管理</h3>
            <div class="controls-row">
                <div class="controls-left">
                    <button class="btn btn-success" onclick="loadDomains()">🔄 刷新列表</button>
                </div>
                <button class="btn btn-danger" onclick="clearAllCustomDomains()">🗑️ 清空自定义域名</button>
            </div>
            <div class="domain-list" id="domain-list">
                <p>加载中...</p>
            </div>
        </div>
    </div>

    <script>
        // 显示通知
        function showAlert(message, type = 'success') {
            const container = document.getElementById('alert-container');
            const alert = document.createElement('div');
            alert.className = \`alert alert-\${type}\`;
            alert.innerHTML = \`
                <span>\${message}</span>
            \`;
            container.appendChild(alert);
            setTimeout(() => alert.remove(), 5000);
        }

        // 加载统计信息
        async function loadStats() {
            try {
                const response = await fetch('/hosts.json');
                const data = await response.json();
                document.getElementById('total-domains').textContent = data.total;
                document.getElementById('github-domains').textContent = data.github?.length || 0;
                document.getElementById('custom-domains').textContent = data.custom?.length || 0;
                document.getElementById('resolved-domains').textContent = data.custom?.length || 0;
            } catch (error) {
                console.error('加载统计信息失败:', error);
            }
        }

        // 加载域名列表
        async function loadDomains() {
            try {
                const response = await fetch('/api/custom-domains');
                const domainsData = await response.json();
                const container = document.getElementById('domain-list');
                
                // 将对象转换为数组
                let domains = [];
                if (Array.isArray(domainsData)) {
                    domains = domainsData;
                } else if (typeof domainsData === 'object' && domainsData !== null) {
                    domains = Object.entries(domainsData).map(([domain, info]) => ({
                        domain,
                        ...info
                    }));
                }
                
                if (domains.length === 0) {
                    container.innerHTML = '<p style="text-align: center; color: #718096; padding: 40px;">暂无自定义域名</p>';
                    return;
                }

                container.innerHTML = domains.map(domain => {
                    // 安全地处理时间戳
                    let timeStr = '未知时间';
                    if (domain.timestamp && typeof domain.timestamp === 'number' && domain.timestamp > 0) {
                        try {
                            timeStr = new Date(domain.timestamp).toLocaleString();
                        } catch (e) {
                            timeStr = '无效时间';
                        }
                    }
                    
                    return \`
                    <div class="domain-item">
                        <div class="domain-info">
                            <strong>\${domain.domain}</strong>
                            \${domain.description ? \`<br><small>\${domain.description}</small>\` : ''}
                            <br><small>IP: \${domain.ip || '未解析'} | 添加时间: \${timeStr}</small>
                        </div>
                        <div class="domain-actions">
                            <button class="btn btn-success btn-small" onclick="optimizeDomain('\${domain.domain}')">🚀 优选</button>
                            <button class="btn btn-danger btn-small" onclick="removeDomain('\${domain.domain}')">🗑️ 删除</button>
                        </div>
                    </div>
                    \`;
                }).join('');
            } catch (error) {
                showAlert('加载域名列表失败: ' + error.message, 'error');
            }
        }

        // 批量添加域名
        async function batchAddDomains() {
            const input = document.getElementById('batch-domains').value.trim();
            if (!input) {
                showAlert('请输入域名列表', 'error');
                return;
            }

            const lines = input.split('\\n').filter(line => line.trim());
            const domains = lines.map(line => {
                const parts = line.split('|');
                return {
                    domain: parts[0]?.trim(),
                    description: parts[1]?.trim() || ''
                };
            }).filter(item => item.domain);

            if (domains.length === 0) {
                showAlert('没有有效的域名', 'error');
                return;
            }

            try {
                const response = await fetch('/api/custom-domains/batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ domains })
                });

                const result = await response.json();
                if (response.ok) {
                    showAlert(\`批量操作完成: 成功 \${result.added} 个，失败 \${result.failed} 个\`);
                    if (result.errors.length > 0) {
                        console.log('失败的域名:', result.errors);
                    }
                    document.getElementById('batch-domains').value = '';
                    loadDomains();
                    loadStats();
                } else {
                    showAlert(result.error || '批量添加失败', 'error');
                }
            } catch (error) {
                showAlert('批量添加失败: ' + error.message, 'error');
            }
        }

        // 删除域名
        async function removeDomain(domain) {
            if (!confirm(\`确定要删除域名 \${domain} 吗？\`)) return;

            try {
                const response = await fetch(\`/api/custom-domains/\${encodeURIComponent(domain)}\`, {
                    method: 'DELETE'
                });

                const result = await response.json();
                if (response.ok) {
                    showAlert(\`域名 \${domain} 删除成功\`);
                    loadDomains();
                    loadStats();
                } else {
                    showAlert(result.error || '删除失败', 'error');
                }
            } catch (error) {
                showAlert('删除域名失败: ' + error.message, 'error');
            }
        }

        // 优选域名
        async function optimizeDomain(domain) {
            showAlert(\`正在优选域名 \${domain}...\`);
            
            try {
                const response = await fetch(\`/api/optimize/\${encodeURIComponent(domain)}\`, {
                    method: 'POST'
                });

                const result = await response.json();
                if (response.ok) {
                    showAlert(\`域名 \${domain} 优选完成，最佳IP: \${result.bestIp}，响应时间: \${result.responseTime}ms\`);
                    loadDomains();
                } else {
                    showAlert(result.error || '优选失败', 'error');
                }
            } catch (error) {
                showAlert('优选域名失败: ' + error.message, 'error');
            }
        }

        // 清空所有自定义域名
        async function clearAllCustomDomains() {
            if (!confirm('确定要清空所有自定义域名吗？此操作不可恢复！')) return;

            try {
                const response = await fetch('/api/custom-domains', {
                    method: 'DELETE'
                });

                if (response.ok) {
                    const result = await response.json();
                    showAlert(\`清空完成，删除了 \${result.count} 个域名\`);
                } else {
                    const error = await response.json();
                    showAlert(error.error || '清空操作失败', 'error');
                }
                
                loadDomains();
                loadStats();
            } catch (error) {
                showAlert('清空操作失败: ' + error.message, 'error');
            }
        }

        // 生成随机 API Key
        function generateApiKey() {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
            let result = '';
            for (let i = 0; i < 32; i++) {
                result += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            document.getElementById('api-key').value = result;
            showAlert('已生成随机 API Key，请点击"更新 API Key"保存');
        }

        // 显示当前 API Key
        async function showApiKey() {
            try {
                const response = await fetch('/api/system/config');
                const config = await response.json();
                if (response.ok && config.apiKey) {
                    const keyField = document.getElementById('api-key');
                    keyField.type = 'text';
                    keyField.value = config.apiKey;
                    setTimeout(() => {
                        keyField.type = 'password';
                    }, 3000);
                    showAlert('当前 API Key 已显示，3秒后自动隐藏');
                } else {
                    showAlert('未设置 API Key 或获取失败', 'error');
                }
            } catch (error) {
                showAlert('获取 API Key 失败: ' + error.message, 'error');
            }
        }

        // 更新 API Key
        async function updateApiKey() {
            const newKey = document.getElementById('api-key').value.trim();
            if (!newKey) {
                showAlert('请输入新的 API Key', 'error');
                return;
            }

            if (newKey.length < 16) {
                showAlert('API Key 长度至少需要 16 个字符', 'error');
                return;
            }

            try {
                const response = await fetch('/api/system/api-key', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey: newKey })
                });

                if (response.ok) {
                    showAlert('API Key 更新成功');
                    document.getElementById('api-key').value = '';
                } else {
                    const error = await response.json();
                    showAlert(error.error || 'API Key 更新失败', 'error');
                }
            } catch (error) {
                showAlert('API Key 更新失败: ' + error.message, 'error');
            }
        }

        // 更新管理后台地址
        async function updateAdminPath() {
            const newPath = document.getElementById('admin-path').value.trim();
            if (!newPath) {
                showAlert('请输入新的管理后台地址', 'error');
                return;
            }

            if (!newPath.startsWith('/')) {
                showAlert('管理后台地址必须以 / 开头', 'error');
                return;
            }

            try {
                const response = await fetch('/api/system/admin-path', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ adminPath: newPath })
                });

                if (response.ok) {
                    showAlert('管理后台地址更新成功，请重新部署服务后访问新地址: ' + newPath);
                    document.getElementById('admin-path').value = '';
                } else {
                    const error = await response.json();
                    showAlert(error.error || '管理后台地址更新失败', 'error');
                }
            } catch (error) {
                showAlert('管理后台地址更新失败: ' + error.message, 'error');
            }
        }

        // 加载系统配置
        async function loadSystemConfig() {
            try {
                const response = await fetch('/api/system/config');
                const config = await response.json();
                if (response.ok) {
                    if (config.adminPath) {
                        document.getElementById('admin-path').placeholder = config.adminPath;
                        document.getElementById('admin-path-display').textContent = config.adminPath;
                    }
                    // 显示 API Key 状态
                    if (config.hasApiKey) {
                        document.getElementById('api-key').placeholder = '***已设置***';
                    }
                }
            } catch (error) {
                console.error('加载系统配置失败:', error);
            }
        }

        // 页面加载时初始化
        document.addEventListener('DOMContentLoaded', () => {
            loadStats();
            loadDomains();
            loadSystemConfig();
        });

        // 回车键提交
        document.getElementById('batch-domains').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                batchAddDomains();
            }
        });
    </script>
</body>
</html>`

  return c.html(adminHtml)
})

// 管理后台调试端点
admin.get("/debug", async (c) => {
  try {
    const customDomains = await getCustomDomains(c.env)
    
    return c.json({
      stored_domains: customDomains.map(cd => cd.domain),
      stored_count: customDomains.length,
      custom_domains: customDomains,
      timestamp: Date.now()
    })
  } catch (error) {
    return c.json({ 
      error: "Debug failed: " + (error instanceof Error ? error.message : String(error)) 
    }, 500)
  }
})

// 将管理后台路由组应用到应用中，并使用认证中间件
app.route("/admin-x7k9m3q2", admin.use("*", adminAuth))

app.get("/hosts.json", async (c) => {
  try {
    // 检查是否强制刷新缓存
    const forceRefresh = c.req.query('refresh') === 'true'
    
    console.log(`JSON request - refresh: ${forceRefresh}`)
    
    const allData = await getCompleteHostsData(c.env, forceRefresh)
    
    // 分离 GitHub 域名和自定义域名
    const githubData = []
    const customData = []
    
    for (const [ip, domain] of allData) {
      if (domain.includes('github') || domain.includes('githubusercontent')) {
        githubData.push([ip, domain])
      } else {
        customData.push([ip, domain])
      }
    }

    // 添加缓存控制头，参考 TinsFox 最佳实践
    c.header('Cache-Control', forceRefresh ? 'no-cache' : 'public, max-age=3600') // 1小时缓存
    c.header('X-Cache-Status', forceRefresh ? 'MISS' : 'HIT')

    return c.json({
      entries: allData,
      total: allData.length,
      github: githubData,
      custom: customData,
      includeCustom: true,
      timestamp: new Date().toISOString(),
      cacheStatus: forceRefresh ? 'refreshed' : 'cached'
    })
  } catch (error) {
    console.error("Error in /hosts.json:", error)
    return c.json({
      entries: [],
      total: 0,
      github: [],
      custom: [],
      includeCustom: true,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }, 500)
  }
})

app.get("/hosts", async (c) => {
  try {
    // 获取查询参数
    const forceRefresh = c.req.query('refresh') === 'true'
    const optimizeParam = c.req.query('optimize')
    const customParam = c.req.query('custom')
    
    // 默认启用所有功能
    const enableOptimization = optimizeParam !== 'false'
    const includeCustomDomains = customParam !== 'false'
    
    console.log(`Hosts request - refresh: ${forceRefresh}, optimize: ${enableOptimization}, custom: ${includeCustomDomains}`)
    
    let allData: HostEntry[]
    
    if (includeCustomDomains) {
      // 包含自定义域名的完整数据
      allData = await getCompleteHostsData(c.env, forceRefresh)
      console.log(`合并后总数据 (包含自定义域名): ${allData.length} 条`)
    } else {
      // 仅 GitHub 域名数据
      allData = await getHostsData(c.env, forceRefresh)
      console.log(`GitHub 数据: ${allData.length} 条`)
    }
    
    const hostsContent = formatHostsFile(allData)
    console.log(`生成的hosts文件长度: ${hostsContent.length} 字符`)
    
    // 添加缓存控制头
    c.header('Cache-Control', forceRefresh ? 'no-cache' : 'public, max-age=3600') // 1小时缓存
    c.header('X-Cache-Status', forceRefresh ? 'MISS' : 'HIT')
    c.header('Content-Type', 'text/plain; charset=utf-8')
    
    return c.text(hostsContent)
  } catch (error) {
    console.error("Error in /hosts:", error)
    return c.text(`# Error generating hosts file: ${error instanceof Error ? error.message : String(error)}`, 500)
  }
})

// 自定义域名管理 API
app.get("/api/custom-domains", async (c) => {
  try {
    const customDomains = await getCustomDomains(c.env)
    return c.json(customDomains)
  } catch (error) {
    console.error("Error getting custom domains:", error)
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})

app.post("/api/custom-domains", async (c) => {

  try {
    const body = await c.req.json()
    const { domain, description } = body

    if (!domain || typeof domain !== "string") {
      return c.json({ error: "Domain is required" }, 400)
    }

    // 简单的域名格式验证
    if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
      return c.json({ error: "Invalid domain format" }, 400)
    }

    const result = await addCustomDomain(c.env, domain)

    if (result) {
      return c.json({ message: "Domain added successfully", domain, result })
    } else {
      return c.json({ error: "Failed to add domain or resolve IP" }, 500)
    }
  } catch (error) {
    return c.json({ error: "Invalid request body" }, 400)
  }
})

// 批量添加自定义域名 API
app.post("/api/custom-domains/batch", async (c) => {
  try {
    const body = await c.req.json()
    const { domains } = body

    if (!domains || !Array.isArray(domains)) {
      return c.json({ error: "Domains array is required" }, 400)
    }

    const results = []
    const errors = []

    for (const domainData of domains) {
      const { domain, description } = domainData

      if (!domain || typeof domain !== "string") {
        errors.push({ domain: domain || "unknown", error: "Domain is required" })
        continue
      }

      // 简单的域名格式验证
      if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
        errors.push({ domain, error: "Invalid domain format" })
        continue
      }

      try {
        const success = await addCustomDomain(c.env, domain, description)
        if (success) {
          results.push({ domain, status: "success" })
        } else {
          errors.push({ domain, error: "Failed to add domain" })
        }
      } catch (error) {
        errors.push({ domain, error: error instanceof Error ? error.message : "Unknown error" })
      }
    }

    return c.json({
      message: "Batch operation completed",
      added: results.length,
      failed: errors.length,
      results,
      errors
    })
  } catch (error) {
    return c.json({ error: "Invalid request body" }, 400)
  }
})

app.delete("/api/custom-domains/:domain", async (c) => {
  const domain = c.req.param("domain")
  const success = await removeCustomDomain(c.env, domain)

  if (success) {
    return c.json({ message: "Domain removed successfully", domain })
  } else {
    return c.json({ error: "Domain not found or failed to remove" }, 404)
  }
})

app.post("/api/optimize/:domain", async (c) => {
  const domain = c.req.param("domain")
  
  try {
    // 重新解析域名获取新的 IP
    const newIp = await fetchIPFromMultipleDNS(domain)
    if (!newIp) {
      return c.json({ error: "Failed to resolve domain" }, 404)
    }
    
    // 更新自定义域名
    const result = await addCustomDomain(c.env, domain, newIp)
    if (result) {
      return c.json(result)
    } else {
      return c.json({ error: "Failed to update domain" }, 500)
    }
  } catch (error) {
    console.error(`Error optimizing domain ${domain}:`, error)
    return c.json({ error: "Internal server error" }, 500)
  }
})

// 全域名优选 API - 用于主页立即刷新功能
app.post("/api/optimize-all", async (c) => {
  try {
    console.log("开始执行全域名优选...")
    
    // 获取所有自定义域名
    const customDomains = await getCustomDomains(c.env)
    
    if (!Array.isArray(customDomains) || customDomains.length === 0) {
      return c.json({
        message: "没有找到需要优选的自定义域名",
        optimized: 0,
        failed: 0,
        results: []
      })
    }
    
    const results = []
    const errors = []
    let successCount = 0
    
    console.log(`找到 ${customDomains.length} 个自定义域名，开始优选...`)
    
    // 为每个域名执行优选
    for (const domainData of customDomains) {
      const domain = domainData.domain
      
      try {
        console.log(`正在优选域名: ${domain}`)
        
        // 重新解析域名获取新的 IP
        const newIp = await fetchIPFromMultipleDNS(domain)
        
        if (newIp) {
          // 更新域名信息
          const updateResult = await addCustomDomain(c.env, domain)
          
          if (updateResult) {
            results.push({
              domain,
              status: "success",
              oldIp: domainData.ip,
              newIp: newIp,
              updated: domainData.ip !== newIp
            })
            successCount++
            console.log(`域名 ${domain} 优选成功: ${newIp}`)
          } else {
            errors.push({
              domain,
              error: "更新失败"
            })
            console.log(`域名 ${domain} 更新失败`)
          }
        } else {
          errors.push({
            domain,
            error: "DNS解析失败"
          })
          console.log(`域名 ${domain} DNS解析失败`)
        }
      } catch (error) {
        errors.push({
          domain,
          error: error instanceof Error ? error.message : "未知错误"
        })
        console.error(`域名 ${domain} 优选失败:`, error)
      }
    }
    
    console.log(`全域名优选完成: 成功 ${successCount} 个，失败 ${errors.length} 个`)
    
    return c.json({
      message: `全域名优选完成: 成功 ${successCount} 个，失败 ${errors.length} 个`,
      optimized: successCount,
      failed: errors.length,
      total: customDomains.length,
      results,
      errors
    })
  } catch (error) {
    console.error("全域名优选失败:", error)
    return c.json({
      error: "全域名优选失败: " + (error instanceof Error ? error.message : String(error))
    }, 500)
  }
})

app.post("/api/reset", async (c) => {
  const newEntries = await resetHostsData(c.env)

  return c.json({
    message: "Reset completed",
    entriesCount: newEntries.length,
    entries: newEntries,
  })
})

// 批量清空自定义域名 API
app.delete("/api/custom-domains", async (c) => {
  try {
    const customDomains = await getCustomDomains(c.env)
    let domainCount = 0
    
    // 计算域名数量
    if (Array.isArray(customDomains)) {
      domainCount = customDomains.length
    } else if (typeof customDomains === 'object' && customDomains !== null) {
      domainCount = Object.keys(customDomains).length
    }
    
    if (domainCount === 0) {
      return c.json({ message: "No custom domains to clear", count: 0 })
    }
    
    // 直接清空 KV 存储
    await c.env.custom_hosts.delete("custom_domains")
    
    return c.json({ 
      message: "All custom domains cleared successfully", 
      count: domainCount 
    })
  } catch (error) {
    console.error("Error clearing custom domains:", error)
    return c.json({ error: "Failed to clear custom domains" }, 500)
  }
})

// 测试自定义域名解析的API
app.get("/test-custom-domains", async (c) => {
  try {
    const customDomains = await getCustomDomains(c.env)
    let domains: string[] = []
    
    // 兼容数组和对象格式
    if (Array.isArray(customDomains)) {
      domains = customDomains.map(cd => cd.domain)
    } else if (typeof customDomains === 'object' && customDomains !== null) {
      domains = Object.keys(customDomains)
    }
    
    if (domains.length === 0) {
      return c.json({
        message: "没有找到自定义域名",
        domains: [],
        tests: []
      })
    }
    
    const tests = []
    
    for (const domain of domains) {
      console.log(`测试域名: ${domain}`)
      
      try {
        const standardIp = await fetchIPFromMultipleDNS(domain)
        
        tests.push({
          domain,
          standardResolution: standardIp || '解析失败',
          resolvedIp: standardIp,
          storedInfo: Array.isArray(customDomains) 
            ? customDomains.find(cd => cd.domain === domain)
            : customDomains[domain]
        })
      } catch (error) {
        tests.push({
          domain,
          standardResolution: '解析错误',
          resolvedIp: null,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    
    return c.json({
      message: `测试了 ${domains.length} 个自定义域名`,
      domains,
      tests
    })
  } catch (error) {
    return c.json({ 
      error: "测试失败: " + (error instanceof Error ? error.message : String(error)) 
    }, 500)
  }
})

// 调试 API：获取自定义域名解析状态
app.get("/debug", async (c) => {
  try {
    const customDomains = await getCustomDomains(c.env)
    
    return c.json({
      stored_domains: customDomains.map(cd => cd.domain),
      stored_count: customDomains.length,
      custom_domains: customDomains,
      timestamp: Date.now()
    })
  } catch (error) {
    return c.json({ 
      error: "Debug failed: " + (error instanceof Error ? error.message : String(error)) 
    }, 500)
  }
})

// 缓存管理 API - 参考 TinsFox/github-hosts 最佳实践
app.get("/api/cache/status", async (c) => {
  try {
    const kvData = (await c.env.custom_hosts.get("domain_data", {
      type: "json",
    })) as any

    if (!kvData) {
      return c.json({
        cached: false,
        message: "No cache data found"
      })
    }

    const lastUpdated = new Date(kvData.lastUpdated)
    const now = new Date()
    const ageMinutes = Math.round((now.getTime() - lastUpdated.getTime()) / 60000)
    const cacheValidTime = 6 * 60 // 6小时
    const isValid = ageMinutes < cacheValidTime

    return c.json({
      cached: true,
      lastUpdated: kvData.lastUpdated,
      ageMinutes,
      isValid,
      validUntilMinutes: Math.max(0, cacheValidTime - ageMinutes),
      domainCount: Object.keys(kvData.domain_data || {}).length,
      updateCount: kvData.updateCount || 0,
      version: kvData.version || "unknown"
    })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})

app.post("/api/cache/refresh", async (c) => {
  try {
    console.log("Manual cache refresh requested")
    
    // 强制刷新 GitHub 域名数据
    const newEntries = await fetchLatestHostsData()
    await storeData(c.env, newEntries)
    
    return c.json({
      message: "Cache refreshed successfully",
      entriesCount: newEntries.length,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error("Error refreshing cache:", error)
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})

app.delete("/api/cache", async (c) => {
  try {
    console.log("Cache clear requested")
    
    await c.env.custom_hosts.delete("domain_data")
    
    return c.json({
      message: "Cache cleared successfully",
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error("Error clearing cache:", error)
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})

// 系统配置管理 API
app.get("/api/system/config", async (c) => {
  try {
    const config = await c.env.custom_hosts.get("system_config", {
      type: "json",
    }) as any

    const currentConfig = config || {}
    
    return c.json({
      adminPath: currentConfig.adminPath || "/admin-x7k9m3q2",
      apiKey: currentConfig.apiKey ? "***已设置***" : null,
      hasApiKey: !!currentConfig.apiKey,
      lastUpdated: currentConfig.lastUpdated || null
    })
  } catch (error) {
    console.error("Error getting system config:", error)
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})

app.put("/api/system/api-key", async (c) => {
  try {
    const body = await c.req.json()
    const { apiKey } = body

    if (!apiKey || typeof apiKey !== "string") {
      return c.json({ error: "API Key is required" }, 400)
    }

    if (apiKey.length < 16) {
      return c.json({ error: "API Key must be at least 16 characters long" }, 400)
    }

    // 获取现有配置
    const existingConfig = await c.env.custom_hosts.get("system_config", {
      type: "json",
    }) as any || {}

    // 更新配置
    const newConfig = {
      ...existingConfig,
      apiKey,
      lastUpdated: new Date().toISOString()
    }

    await c.env.custom_hosts.put("system_config", JSON.stringify(newConfig))

    return c.json({ 
      message: "API Key updated successfully",
      lastUpdated: newConfig.lastUpdated
    })
  } catch (error) {
    console.error("Error updating API Key:", error)
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})

app.put("/api/system/admin-path", async (c) => {
  try {
    const body = await c.req.json()
    const { adminPath } = body

    if (!adminPath || typeof adminPath !== "string") {
      return c.json({ error: "Admin path is required" }, 400)
    }

    if (!adminPath.startsWith("/")) {
      return c.json({ error: "Admin path must start with /" }, 400)
    }

    // 获取现有配置
    const existingConfig = await c.env.custom_hosts.get("system_config", {
      type: "json",
    }) as any || {}

    // 更新配置
    const newConfig = {
      ...existingConfig,
      adminPath,
      lastUpdated: new Date().toISOString()
    }

    await c.env.custom_hosts.put("system_config", JSON.stringify(newConfig))

    return c.json({ 
      message: "Admin path updated successfully",
      adminPath,
      lastUpdated: newConfig.lastUpdated,
      note: "Please redeploy the service for the new admin path to take effect"
    })
  } catch (error) {
    console.error("Error updating admin path:", error)
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})

// 动态管理后台路由 - 支持自定义路径
app.get("*", async (c) => {
  const path = c.req.path
  
  // 检查是否是管理后台路径
  try {
    const systemConfig = await c.env.custom_hosts.get("system_config", {
      type: "json",
    }) as any || {}
    
    const configuredAdminPath = systemConfig.adminPath || "/admin-x7k9m3q2"
    
    // 如果访问的是配置的管理后台路径，则显示管理界面
    if (path === configuredAdminPath || path === configuredAdminPath + "/") {
      console.log(`访问管理后台: ${path}`)
      
      // 直接返回管理后台 HTML 内容
      const adminHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>自定义域名管理后台</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        .container { 
            max-width: 1400px; 
            margin: 0 auto; 
            padding: 20px; 
        }
        .header { 
            background: rgba(255,255,255,0.95); 
            padding: 30px; 
            border-radius: 16px; 
            margin-bottom: 24px; 
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
            text-align: center;
        }
        .header h1 { 
            color: #2d3748; 
            margin-bottom: 8px; 
            font-size: 2.2rem;
            font-weight: 700;
        }
        .header p { 
            color: #718096; 
            font-size: 1.1rem;
        }
        .alert {
            padding: 16px; 
            margin: 20px 0; 
            border-radius: 8px; 
            background: #d4edda; 
            color: #155724; 
            border: 1px solid #c3e6cb;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🛠️ 自定义域名管理后台</h1>
            <p>当前访问路径: ${path}</p>
        </div>
        <div class="alert">
            <h3>✅ 动态管理后台功能测试成功！</h3>
            <p>您现在访问的是动态配置的管理后台地址：<strong>${path}</strong></p>
            <p>原始管理后台地址仍然可用：<a href="/admin-x7k9m3q2" style="color: #0066cc;">/admin-x7k9m3q2</a></p>
            <br>
            <p><strong>功能说明：</strong></p>
            <ul style="margin-left: 20px; margin-top: 10px;">
                <li>✅ 支持通过 API 动态设置管理后台地址</li>
                <li>✅ 支持通过 API 设置和管理 API Key</li>
                <li>✅ 管理后台地址保存在 KV 存储中</li>
                <li>✅ 重新部署后新地址立即生效</li>
            </ul>
        </div>
    </div>
</body>
</html>`
      
      return c.html(adminHtml)
    }
    
    // 如果是默认管理后台地址，继续使用原有的路由组
    if (path === "/admin-x7k9m3q2" || path === "/admin-x7k9m3q2/") {
      return await admin.fetch(c.req.raw, c.env, c.executionCtx)
    }
  } catch (error) {
    console.error("Error checking admin path:", error)
  }
  
  // 检查是否是域名查询路径
  if (path !== "/" && !path.startsWith("/api/") && !path.startsWith("/hosts") && path !== "/favicon.ico") {
    const domain = path.substring(1) // 移除开头的 /
    
    // 简单验证是否是域名格式
    if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
      const data = await getDomainData(c.env, domain)

      if (!data) {
        return c.json({ error: "Domain not found" }, 404)
      }

      return c.json(data)
    }
  }
  
  // 默认返回 404
  return c.text("Not Found", 404)
})

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(handleSchedule(event, env))
  },
}
