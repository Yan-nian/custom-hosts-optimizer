#!/bin/bash

# 部署前检查脚本

echo "🔍 部署前检查..."
echo "=================="

# 检查 Node.js 版本
echo "📋 Node.js 版本:"
node --version

# 检查 pnpm 版本  
echo "📋 pnpm 版本:"
pnpm --version

# 检查 wrangler 版本
echo "📋 Wrangler 版本:"
pnpm exec wrangler --version

# 检查是否已登录 Cloudflare
echo "🔐 Cloudflare 登录状态:"
if pnpm exec wrangler auth whoami &> /dev/null; then
    echo "✅ 已登录: $(pnpm exec wrangler auth whoami)"
else
    echo "❌ 未登录 Cloudflare"
    echo "请运行: pnpm exec wrangler auth login"
fi

# 检查配置文件
echo "📄 配置文件检查:"
if [ -f "wrangler.toml" ]; then
    echo "✅ wrangler.toml 存在"
    
    # 检查 KV 绑定
    if grep -q "binding = \"github_hosts\"" wrangler.toml; then
        echo "✅ KV 绑定配置正确"
        kv_id=$(grep 'id = ' wrangler.toml | head -1 | cut -d'"' -f2)
        echo "   KV ID: $kv_id"
    else
        echo "❌ KV 绑定配置缺失"
    fi
    
    # 检查定时任务
    if grep -q "crons" wrangler.toml; then
        echo "✅ 定时任务配置存在"
    else
        echo "⚠️  定时任务配置缺失"
    fi
else
    echo "❌ wrangler.toml 不存在"
fi

# 检查源代码
echo "📝 源代码检查:"
if [ -f "src/index.ts" ]; then
    echo "✅ 主入口文件存在"
else
    echo "❌ 主入口文件缺失"
fi

if [ -d "public" ]; then
    echo "✅ 静态资源目录存在"
    file_count=$(find public -type f | wc -l)
    echo "   包含 $file_count 个文件"
else
    echo "❌ 静态资源目录缺失"
fi

# 检查依赖
echo "📦 依赖检查:"
if [ -f "package.json" ]; then
    echo "✅ package.json 存在"
    if [ -d "node_modules" ]; then
        echo "✅ 依赖已安装"
    else
        echo "⚠️  依赖未安装，请运行: pnpm install"
    fi
else
    echo "❌ package.json 不存在"
fi

# 检查 secrets
echo "🔐 Secrets 检查:"
if pnpm exec wrangler auth whoami &> /dev/null; then
    if pnpm exec wrangler secret list | grep -q "API_KEY"; then
        echo "✅ API_KEY 已配置"
    else
        echo "⚠️  API_KEY 未配置"
        echo "   请运行: pnpm exec wrangler secret put API_KEY"
    fi
    
    if pnpm exec wrangler secret list | grep -q "ENABLE_OPTIMIZATION"; then
        echo "✅ ENABLE_OPTIMIZATION 已配置"
    else
        echo "ℹ️  ENABLE_OPTIMIZATION 未配置（可选）"
    fi
else
    echo "❌ 无法检查 secrets - 请先登录 Cloudflare"
fi

echo ""
echo "🚀 准备部署?"
echo "如果所有检查都通过，可以运行: ./deploy.sh 或 pnpm run deploy"

echo ""
echo "🔧 Workers 环境诊断:"
echo "==================="
echo "常见问题及解决方案:"
echo ""
echo "1. 本地正常但线上异常的原因:"
echo "   - KV 存储未正确绑定或数据为空"
echo "   - DNS 解析在 Workers 环境中受限制"
echo "   - Assets 静态文件未正确部署"
echo "   - 环境变量配置不一致"
echo "   - TypeScript 编译或运行时错误"
echo ""
echo "2. 调试步骤:"
echo "   - wrangler deploy --dry-run    # 预检查部署"
echo "   - wrangler tail                 # 查看实时日志"
echo "   - 访问 /debug 端点查看服务状态"
echo "   - 检查 Workers 控制台的错误日志"
echo ""
echo "3. KV 存储检查:"
if command -v wrangler &> /dev/null; then
    echo "   正在检查 KV namespaces..."
    pnpm exec wrangler kv:namespace list 2>/dev/null || echo "   ⚠️  无法获取 KV namespaces"
else
    echo "   ⚠️  wrangler CLI 未找到"
fi
echo ""
echo "4. 推荐检查顺序:"
echo "   1. 确保 wrangler.toml 配置正确"
echo "   2. 确保 KV namespace 已创建并绑定"
echo "   3. 确保 public 目录存在必要的静态文件"
echo "   4. 本地测试 wrangler dev 是否正常"
echo "   5. 使用 wrangler deploy 部署到线上"
