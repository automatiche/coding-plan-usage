"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const axios_1 = __importDefault(require("axios"));
const API_URL = 'https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains';
// 中英文国际化
const isEnglish = vscode.env.language.startsWith('en');
const i18n = {
    loading: isEnglish ? 'Loading...' : '加载额度...',
    configApiKey: isEnglish ? 'Please configure API Key' : '请配置 API Key',
    configHint: isEnglish ? 'Set codingPlanUsage.apiKey in settings' : '在设置中配置 codingPlanUsage.apiKey',
    querying: isEnglish ? 'Querying...' : '查询中...',
    used: isEnglish ? 'used' : '已使用',
    queryFailed: isEnglish ? 'Query failed' : '查询失败',
    unknownError: isEnglish ? 'Unknown error' : '未知错误',
    networkError: isEnglish ? 'Network error' : '网络错误',
    resetIn: isEnglish ? 'mins until reset' : '分钟后重置',
    deprecatedNote: isEnglish
        ? '\n\nNote: codingPlan.apiKey is deprecated, please migrate to codingPlanUsage.apiKey'
        : '\n\n提示: 配置项 codingPlan.apiKey 已弃用，请迁移到 codingPlanUsage.apiKey',
    clickToRefresh: isEnglish ? 'Click to refresh' : '点击刷新额度',
};
function activate(context) {
    // 创建状态栏项
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = `$(loading~spin) ${i18n.loading}`;
    statusBarItem.command = 'coding-plan-usage.refresh';
    statusBarItem.tooltip = i18n.clickToRefresh;
    statusBarItem.show();
    // 获取 API Key
    const getApiKey = () => {
        const fromNew = vscode.workspace.getConfiguration('codingPlanUsage').get('apiKey');
        if (fromNew) {
            return { value: fromNew, source: 'codingPlanUsage' };
        }
        const fromOld = vscode.workspace.getConfiguration('codingPlan').get('apiKey');
        if (fromOld) {
            return { value: fromOld, source: 'codingPlan' };
        }
        return { value: undefined, source: 'none' };
    };
    // 查询额度
    const fetchUsage = async () => {
        const apiKeyInfo = getApiKey();
        if (!apiKeyInfo.value) {
            statusBarItem.text = `$(error) ${i18n.configApiKey}`;
            statusBarItem.tooltip = i18n.configHint;
            return;
        }
        statusBarItem.text = `$(loading~spin) ${i18n.querying}`;
        try {
            const response = await axios_1.default.get(API_URL, {
                headers: {
                    'Authorization': `Bearer ${apiKeyInfo.value}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });
            const data = response.data;
            if (data.base_resp?.status_code === 0 && data.model_remains) {
                // 使用第一个模型的数据
                const modelData = data.model_remains[0];
                const totalCalls = Number(modelData.current_interval_total_count || 0);
                // API 返回的 current_interval_usage_count 实际上是「剩余可用调用分数/次数」
                const remainingCalls = Number(modelData.current_interval_usage_count || 0);
                // 计算已使用的调用次数
                const usedCalls = Math.max(0, totalCalls - remainingCalls);
                // 官方文档：1个 prompt 约等于 15 次模型调用
                const CALLS_PER_PROMPT = 15;
                // 根据官方逻辑，总额度 (e.g. 600 / 15 = 40 prompts)
                const cycleTotalPrompts = Math.floor(totalCalls / CALLS_PER_PROMPT);
                // 计算使用的 prompt 次数，向上取整（只要涉及调用就算消耗了一个 prompt 的部分额度）
                const usedPrompts = Math.ceil(usedCalls / CALLS_PER_PROMPT);
                // 剩余 prompt 数量
                const cycleRemainingPrompts = Math.max(0, cycleTotalPrompts - usedPrompts);
                // 计算精确已使用百分比（基于真实底层调用次数，而不是缩小版 prompt 数）
                // 比如使用了 6 次调用（6/600=1%）
                const usedPercent = totalCalls > 0
                    ? Math.round((usedCalls / totalCalls) * 100)
                    : 0;
                // 计算当前5小时周期的时间段
                const now = new Date();
                const currentHour = now.getHours();
                const currentMinute = now.getMinutes();
                const currentTimeInMinutes = currentHour * 60 + currentMinute;
                // 5小时周期：0:00-5:00, 5:00-10:00, 10:00-15:00, 15:00-20:00, 20:00-24:00
                const cycleIndex = Math.floor(currentTimeInMinutes / 300);
                const cycleStartHour = cycleIndex * 5;
                const cycleEndHour = Math.min((cycleIndex + 1) * 5, 24);
                // 格式化时间段
                const formatHour = (h) => {
                    return h.toString().padStart(2, '0');
                };
                const timeRange = `${formatHour(cycleStartHour)}:00-${formatHour(cycleEndHour)}:00`;
                // 计算当前周期剩余时间（秒）
                const cycleElapsedMinutes = currentTimeInMinutes - cycleIndex * 300;
                const cycleRemainingSeconds = 5 * 3600 - cycleElapsedMinutes * 60;
                // 订阅剩余时间（将API返回的秒数转为天，通常是半年大约183天） ！不准确
                // const remainDays = modelData.remains_time 
                //   ? (Number(modelData.remains_time) / (24 * 3600)).toFixed(1)
                //   : '?';
                // 主界面显示百分比
                statusBarItem.text = `$(sparkle) ${usedPercent}%`;
                // 格式化剩余时间为分钟
                const formatRemainingMins = (seconds) => {
                    const mins = Math.floor(seconds / 60);
                    return `${mins} ${i18n.resetIn}`;
                };
                const keySourceNote = apiKeyInfo.source === 'codingPlan'
                    ? i18n.deprecatedNote
                    : '';
                statusBarItem.tooltip =
                    `${timeRange}\n${formatRemainingMins(cycleRemainingSeconds)}` +
                        keySourceNote;
            }
            else {
                statusBarItem.text = `$(error) ${i18n.queryFailed}`;
                statusBarItem.tooltip = data.base_resp?.status_msg || i18n.unknownError;
            }
        }
        catch (error) {
            statusBarItem.text = `$(error) ${i18n.queryFailed}`;
            statusBarItem.tooltip = error.message || i18n.networkError;
        }
    };
    // 注册刷新命令
    const refreshCommand = vscode.commands.registerCommand('coding-plan-usage.refresh', fetchUsage);
    context.subscriptions.push(statusBarItem, refreshCommand);
    // 启动时自动查询
    fetchUsage();
}
function deactivate() { }
