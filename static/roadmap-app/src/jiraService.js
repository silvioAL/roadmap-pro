// ============================================================================
// JIRA SERVICE - Comunicação com Backend Forge
// ============================================================================

let invoke;
try {
    const forgeBridge = require('@forge/bridge');
    invoke = forgeBridge.invoke;
} catch (e) {
    // Mock para desenvolvimento local
    invoke = async (method, payload) => {
        console.log(`[DEV] invoke('${method}', ${JSON.stringify(payload)})`);

        switch (method) {
            case 'getIssueTypes':
                return {
                    success: true,
                    projectKey: 'DEMO',
                    projectId: '10000',
                    projectName: 'Demo Project',
                    issueTypes: [
                        { id: '1', name: 'Epic', hierarchyLevel: 1, iconUrl: null },
                        { id: '2', name: 'Story', hierarchyLevel: 0, iconUrl: null },
                        { id: '3', name: 'Task', hierarchyLevel: 0, iconUrl: null },
                        { id: '4', name: 'Initiative', hierarchyLevel: 2, iconUrl: null }
                    ]
                };
            case 'getLinkTypes':
                return {
                    success: true,
                    linkTypes: [
                        { id: '1', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
                        { id: '2', name: 'Relates', inward: 'relates to', outward: 'relates to' }
                    ]
                };
            case 'loadConfig':
                const savedConfig = localStorage.getItem('roadmap_config_v3');
                return { success: true, config: savedConfig ? JSON.parse(savedConfig) : null };
            case 'saveConfig':
                localStorage.setItem('roadmap_config_v3', JSON.stringify(payload.config));
                return { success: true };
            case 'loadRoadmapData':
                const savedData = localStorage.getItem('roadmap_data_v3');
                return { success: true, data: savedData ? JSON.parse(savedData) : null };
            case 'saveRoadmapData':
                localStorage.setItem('roadmap_data_v3', JSON.stringify(payload.data));
                return { success: true };
            case 'searchIssues':
                return { success: true, issues: [], total: 0 };
            case 'countChildIssues':
                return { success: true, total: 5, todo: 2, inProgress: 2, done: 1 };
            case 'getCurrentWip':
                return { success: true, wip: 3 };
            case 'getAllMetrics':
                return {
                    success: true,
                    metrics: {
                        throughput: { average: 5, stdDev: 1.5, cov: 0.3, totalIssues: 60 },
                        leadTime: { averageDays: 14, averageWeeks: 2 },
                        wip: { atual: 8, ideal: 10, utilizationPercent: 80 }
                    }
                };
            case 'getThroughputHistory':
                return {
                    success: true,
                    statistics: { average: 5, stdDev: 1.5, cov: 0.3 }
                };
            case 'getLeadTimeHistory':
                return {
                    success: true,
                    leadTime: { avg: 14, median: 12, p85: 21, p95: 28 },
                    cycleTime: { avg: 7, median: 5, p85: 12, p95: 18 }
                };
            case 'getWipIdeal':
                return { success: true, wipIdeal: 10, throughputPerWeek: 5, leadTimeDays: 14 };
            default:
                return { success: false, error: 'Method not implemented in dev mode' };
        }
    };
}

// ============================================================================
// API METHODS
// ============================================================================

export const jiraService = {
    // Configuração
    async getIssueTypes() {
        return invoke('getIssueTypes');
    },

    async getLinkTypes() {
        return invoke('getLinkTypes');
    },

    async getCustomFields() {
        return invoke('getCustomFields');
    },

    // Busca de Issues
    async searchIssues(issueTypes, maxResults = 100, startAt = 0) {
        return invoke('searchIssues', { issueTypes, maxResults, startAt });
    },

    async searchIssuesWithJql(jql, maxResults = 100, startAt = 0) {
        return invoke('searchIssues', { jql, maxResults, startAt });
    },

    async countChildIssues(parentKey, countDone = true) {
        return invoke('countChildIssues', { parentKey, countDone });
    },

    async getIssueDetails(issueKey) {
        return invoke('getIssueDetails', { issueKey });
    },

    // Métricas
    async getThroughputHistory(weeks = 12, issueTypes = null, serviceClassField = null) {
        return invoke('getThroughputHistory', { weeks, issueTypes, serviceClassField });
    },

    async getLeadTimeHistory(weeks = 12, issueTypes = null) {
        return invoke('getLeadTimeHistory', { weeks, issueTypes });
    },

    async getCurrentWip(issueTypes = null) {
        return invoke('getCurrentWip', { issueTypes });
    },

    async getWipIdeal(issueTypes = null, weeks = 12) {
        return invoke('getWipIdeal', { issueTypes, weeks });
    },

    async getAllMetrics(issueTypes = null, weeks = 12) {
        return invoke('getAllMetrics', { issueTypes, weeks });
    },

    // Storage
    async saveConfig(config) {
        return invoke('saveConfig', { config });
    },

    async loadConfig() {
        return invoke('loadConfig');
    },

    async saveRoadmapData(data) {
        return invoke('saveRoadmapData', { data });
    },

    async loadRoadmapData() {
        return invoke('loadRoadmapData');
    }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extrai dependências dos links do Jira
 * @param {Array} links - Array de links do Jira
 * @param {Object} linkTypeMapping - Mapeamento de tipos de link
 * @returns {Array} Array de dependências formatadas
 */
export function extractDependencies(links, linkTypeMapping = {}) {
    if (!links || !Array.isArray(links)) return [];

    const dependencies = [];

    links.forEach(link => {
        const linkTypeName = link.type.name;
        const mapping = linkTypeMapping[linkTypeName];

        if (link.inwardIssue) {
            // Este issue é bloqueado pelo inwardIssue
            dependencies.push({
                targetId: link.inwardIssue.id,
                targetKey: link.inwardIssue.key,
                targetSummary: link.inwardIssue.summary,
                targetStatus: link.inwardIssue.status,
                type: mapping?.inwardType || 'blockedBy',
                linkTypeName
            });
        }

        if (link.outwardIssue) {
            // Este issue bloqueia o outwardIssue
            dependencies.push({
                targetId: link.outwardIssue.id,
                targetKey: link.outwardIssue.key,
                targetSummary: link.outwardIssue.summary,
                targetStatus: link.outwardIssue.status,
                type: mapping?.outwardType || 'blocks',
                linkTypeName
            });
        }
    });

    return dependencies;
}

/**
 * Verifica se um item está bloqueado
 * @param {Array} dependencies - Dependências do item
 * @param {Object} issueStatusMap - Mapa de status das issues
 * @returns {Object} { isBlocked, blockers }
 */
export function checkBlockedStatus(dependencies, issueStatusMap = {}) {
    if (!dependencies || dependencies.length === 0) {
        return { isBlocked: false, blockers: [] };
    }

    const blockers = dependencies
        .filter(dep => dep.type === 'blockedBy' || dep.type === 'blocked-by')
        .filter(dep => {
            const status = issueStatusMap[dep.targetKey] || dep.targetStatus;
            return status !== 'Done' && status !== 'Concluído';
        });

    return {
        isBlocked: blockers.length > 0,
        blockers
    };
}

/**
 * Calcula WIP Ideal usando Lei de Little
 * @param {number} throughput - Throughput médio por semana
 * @param {number} leadTimeDays - Lead time médio em dias
 * @returns {number} WIP ideal
 */
export function calculateWipIdeal(throughput, leadTimeDays) {
    const leadTimeWeeks = leadTimeDays / 7;
    return Math.max(1, Math.round(throughput * leadTimeWeeks));
}

/**
 * Calcula estatísticas de um array de números
 * @param {Array} values - Array de números
 * @returns {Object} { avg, median, stdDev, cov, p85, p95 }
 */
export function calculateStats(values) {
    if (!values || values.length === 0) {
        return { avg: 0, median: 0, stdDev: 0, cov: 0, p85: 0, p95: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return {
        avg: Math.round(avg * 100) / 100,
        median: sorted[Math.floor(sorted.length / 2)],
        stdDev: Math.round(stdDev * 100) / 100,
        cov: avg > 0 ? Math.round((stdDev / avg) * 100) / 100 : 0,
        p85: sorted[Math.floor(sorted.length * 0.85)],
        p95: sorted[Math.floor(sorted.length * 0.95)]
    };
}

/**
 * Formata data para exibição
 * @param {string|Date} date - Data
 * @returns {string} Data formatada dd/mm/yyyy
 */
export function formatDate(date) {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('pt-BR');
}

/**
 * Formata data curta
 * @param {string|Date} date - Data
 * @returns {string} Data formatada dd/mm
 */
export function formatDateShort(date) {
    if (!date) return '—';
    const d = new Date(date);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default jiraService;