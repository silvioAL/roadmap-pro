import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './App.css';

// ============================================================================
// CONSTANTES E CONFIGURAÇÕES
// ============================================================================

const SQUAD_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const SERVICE_CLASSES = {
  standard: {
    name: 'Standard',
    color: '#3b82f6',
    icon: '⭐',
    description: 'Trabalho regular com prazo flexível',
    defaultCoV: 0.30
  },
  expedite: {
    name: 'Expedite',
    color: '#ef4444',
    icon: '🔥',
    description: 'Urgente, interrompe fluxo normal',
    defaultCoV: 0.50
  },
  fixed: {
    name: 'Fixed Date',
    color: '#f59e0b',
    icon: '📅',
    description: 'Data fixa/compromisso externo',
    defaultCoV: 0.20
  },
  intangible: {
    name: 'Intangible',
    color: '#8b5cf6',
    icon: '🔧',
    description: 'Valor difícil de quantificar (tech debt)',
    defaultCoV: 0.40
  }
};

const WORK_TYPES = {
  new_feature: { name: 'Nova Funcionalidade', icon: '🚀', color: '#10b981' },
  improvement: { name: 'Melhoria', icon: '✨', color: '#3b82f6' },
  tech_debt: { name: 'Débito Técnico', icon: '🔧', color: '#f59e0b' },
  bug: { name: 'Bug/Correção', icon: '🐛', color: '#ef4444' },
  maintenance: { name: 'Manutenção', icon: '🛠️', color: '#6b7280' }
};

const ITEM_TYPES = {
  initiative: { name: 'Iniciativa', icon: '🎯', level: 0 },
  epic: { name: 'Épico', icon: '📦', level: 1 },
  issue: { name: 'Issue', icon: '📝', level: 2 }
};

const DEPENDENCY_TYPES = {
  blockedBy: { name: 'Bloqueado por', icon: '🚫', color: '#ef4444' },
  blocks: { name: 'Bloqueia', icon: '⏸️', color: '#f59e0b' },
  relatedTo: { name: 'Relacionado a', icon: '🔗', color: '#3b82f6' }
};

const DEFAULT_FLAGS = [
  { id: 'blocked', name: 'Bloqueado', icon: '🚫', color: '#ef4444' },
  { id: 'at_risk', name: 'Em Risco', icon: '⚠️', color: '#f59e0b' },
  { id: 'ready', name: 'Pronto', icon: '✅', color: '#10b981' }
];

// ============================================================================
// FUNÇÕES UTILITÁRIAS
// ============================================================================

const generateId = () => Date.now() + Math.random();

const createDefaultSquad = (name, index = 0) => ({
  id: generateId(),
  name,
  color: SQUAD_COLORS[index % SQUAD_COLORS.length],
  throughput: 7,
  leadTime: 14,
  wipLimit: 5,
  wipAtual: 0,
  classMetrics: {
    standard: { cov: 0.30 },
    expedite: { cov: 0.50 },
    fixed: { cov: 0.20 },
    intangible: { cov: 0.40 }
  }
});

const createDefaultItem = (name, type = 'epic', squadId = null) => ({
  id: generateId(),
  name,
  type,
  selected: true,
  priority: 999,
  serviceClass: 'standard',
  workType: 'new_feature',
  parentId: null,
  squadAllocations: squadId ? [{ squadId, issues: 10, startDate: null }] : [],
  dependencies: [],
  flags: [],
  jiraKey: null,
  jiraStatus: null,
  completedIssues: 0
});

// Calcula WIP Ideal usando Lei de Little
const calculateWipIdeal = (squad) => {
  const leadTimeWeeks = squad.leadTime / 7;
  return Math.round(squad.throughput * leadTimeWeeks);
};

// Calcula status do WIP
const getWipStatus = (squad) => {
  const wipIdeal = calculateWipIdeal(squad);
  if (squad.wipAtual <= wipIdeal) return 'ok';
  if (squad.wipAtual <= wipIdeal * 1.5) return 'warning';
  return 'danger';
};

// Total de issues de um item
const getTotalIssues = (item) => {
  return (item.squadAllocations || []).reduce((sum, a) => sum + (a.issues || 0), 0);
};

// Progresso do item
const getProgress = (item) => {
  const total = getTotalIssues(item);
  if (total === 0) return 0;
  return Math.round((item.completedIssues || 0) / total * 100);
};

// Converte semanas para data
const weeksToDate = (weeks) => {
  const d = new Date();
  d.setDate(d.getDate() + weeks * 7);
  return d.toLocaleDateString('pt-BR');
};

// Converte data para semanas a partir de hoje
const dateToWeeks = (dateStr) => {
  if (!dateStr) return 0;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  const diffMs = target - now;
  return Math.max(0, diffMs / (7 * 24 * 60 * 60 * 1000));
};

// Gera semanas para timeline
const generateWeeks = (numWeeks = 52) => {
  const weeks = [];
  const today = new Date();
  const currentWeekStart = new Date(today);
  currentWeekStart.setDate(today.getDate() - today.getDay() + 1);
  
  for (let i = 0; i < numWeeks; i++) {
    const weekStart = new Date(currentWeekStart);
    weekStart.setDate(weekStart.getDate() + (i * 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weeks.push({
      index: i,
      start: weekStart,
      end: weekEnd,
      label: `S${i + 1}`,
      dateLabel: weekStart.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    });
  }
  return weeks;
};

// ============================================================================
// ALGORITMOS PRINCIPAIS
// ============================================================================

// Simulação Monte Carlo com distribuição log-normal
const monteCarloSimulation = (issues, throughput, cov, numSimulations = 10000) => {
  const results = [];
  
  for (let i = 0; i < numSimulations; i++) {
    // Distribuição log-normal para throughput
    const variance = Math.log(1 + cov * cov);
    const mu = Math.log(throughput) - variance / 2;
    
    // Box-Muller para gerar normal
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    // Converte para log-normal
    const simulatedThroughput = Math.exp(mu + Math.sqrt(variance) * z);
    
    // Calcula semanas para completar
    const weeksNeeded = issues / Math.max(0.1, simulatedThroughput);
    results.push(weeksNeeded);
  }
  
  results.sort((a, b) => a - b);
  
  return {
    p5: results[Math.floor(numSimulations * 0.05)],
    p50: results[Math.floor(numSimulations * 0.50)],
    p85: results[Math.floor(numSimulations * 0.85)],
    p95: results[Math.floor(numSimulations * 0.95)],
    results
  };
};

// Ordenação topológica com prioridade (dependências)
const topologicalSortWithPriority = (items) => {
  const levels = new Map();
  const visited = new Set();
  const prioritySuggestions = new Map();
  
  const getLevel = (item) => {
    if (visited.has(item.id)) return levels.get(item.id) || 0;
    visited.add(item.id);
    
    let maxBlockerLevel = -1;
    
    if (item.dependencies) {
      item.dependencies
        .filter(d => d.type === 'blockedBy')
        .forEach(dep => {
          const blocker = items.find(e => String(e.id) === String(dep.targetId));
          if (blocker) {
            const blockerLevel = getLevel(blocker);
            maxBlockerLevel = Math.max(maxBlockerLevel, blockerLevel);
            
            // Detecta conflito de prioridade
            if ((blocker.priority || 999) > (item.priority || 999)) {
              prioritySuggestions.set(blocker.id, {
                newPriority: (item.priority || 1) - 1,
                reason: `Bloqueia ${item.name}`
              });
            }
          }
        });
    }
    
    const level = maxBlockerLevel + 1;
    levels.set(item.id, level);
    return level;
  };
  
  items.forEach(item => getLevel(item));
  
  const sorted = [...items].sort((a, b) => {
    const levelA = levels.get(a.id) || 0;
    const levelB = levels.get(b.id) || 0;
    if (levelA !== levelB) return levelA - levelB;
    return (a.priority || 999) - (b.priority || 999);
  });
  
  return { sorted, levels, prioritySuggestions };
};

// Bin Packing para agendamento
const binPackingAllocation = (squad, minWeekIndex, totalIssues, weekLoads, targetLoadFactor) => {
  const maxLoadPerWeek = squad.throughput * targetLoadFactor;
  
  let remaining = totalIssues;
  let weekIdx = minWeekIndex;
  let firstWeek = -1;
  let lastWeek = minWeekIndex;
  
  while (remaining > 0.01 && weekIdx < 104) {
    const currentLoad = weekLoads.get(`${squad.id}-${weekIdx}`) || 0;
    const available = maxLoadPerWeek - currentLoad;
    
    if (available > 0.01) {
      const toAllocate = Math.min(remaining, available);
      weekLoads.set(`${squad.id}-${weekIdx}`, currentLoad + toAllocate);
      remaining -= toAllocate;
      
      if (firstWeek === -1) firstWeek = weekIdx;
      lastWeek = weekIdx;
    }
    weekIdx++;
  }
  
  return { startWeek: firstWeek, endWeek: lastWeek };
};

// Calcula data mais cedo possível considerando dependências
const calculateEarliestStart = (item, items, epicEndDates) => {
  let earliest = 0;
  
  (item.dependencies || [])
    .filter(d => d.type === 'blockedBy')
    .forEach(dep => {
      const endDate = epicEndDates.get(String(dep.targetId));
      if (endDate !== undefined && endDate > earliest) {
        earliest = endDate + 1;
      }
    });
  
  return earliest;
};

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

function App() {
  // Estado Principal
  const [squads, setSquads] = useState([]);
  const [items, setItems] = useState([]);
  const [currentView, setCurrentView] = useState('planning'); // planning, queue, timeline, heatmap, results
  const [results, setResults] = useState(null);
  const [toast, setToast] = useState(null);
  
  // Estado dos Modais
  const [showSquadModal, setShowSquadModal] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [showDepsModal, setShowDepsModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [editingSquad, setEditingSquad] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({});
  
  // Estado do Agendamento
  const [scheduleProposals, setScheduleProposals] = useState([]);
  
  // Configurações
  const [config, setConfig] = useState({
    simulations: 10000,
    autoSimulate: true,
    targetLoad: 100,
    respectDependencies: true,
    respectWip: true
  });

  // ============================================================================
  // TOAST
  // ============================================================================
  
  const showToast = useCallback((message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ============================================================================
  // PERSISTÊNCIA
  // ============================================================================
  
  const saveData = useCallback(() => {
    const data = { squads, items, config };
    localStorage.setItem('roadmap_data_v2', JSON.stringify(data));
  }, [squads, items, config]);

  const loadData = useCallback(() => {
    try {
      const saved = localStorage.getItem('roadmap_data_v2');
      if (saved) {
        const data = JSON.parse(saved);
        if (data.squads) setSquads(data.squads);
        if (data.items) setItems(data.items);
        if (data.config) setConfig(prev => ({ ...prev, ...data.config }));
      }
    } catch (e) {
      console.error('Erro ao carregar dados:', e);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (squads.length > 0 || items.length > 0) {
      saveData();
    }
  }, [squads, items, config, saveData]);

  // Inicializa com squad padrão
  useEffect(() => {
    if (squads.length === 0) {
      setSquads([createDefaultSquad('Squad Alpha', 0)]);
    }
  }, [squads.length]);

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================
  
  const selectedItems = useMemo(() => items.filter(i => i.selected), [items]);
  const totalSelectedIssues = useMemo(() => 
    selectedItems.reduce((sum, i) => sum + getTotalIssues(i), 0), 
    [selectedItems]
  );

  // Itens organizados por hierarquia
  const itemsByParent = useMemo(() => {
    const map = new Map();
    items.forEach(item => {
      const parentId = item.parentId || 'root';
      if (!map.has(parentId)) map.set(parentId, []);
      map.get(parentId).push(item);
    });
    return map;
  }, [items]);

  // ============================================================================
  // SQUAD FUNCTIONS
  // ============================================================================
  
  const openAddSquadModal = () => {
    setEditingSquad(null);
    setFormData({
      name: '',
      throughput: 7,
      leadTime: 14,
      wipLimit: 5,
      wipAtual: 0,
      color: SQUAD_COLORS[squads.length % SQUAD_COLORS.length],
      classMetrics: {
        standard: { cov: 0.30 },
        expedite: { cov: 0.50 },
        fixed: { cov: 0.20 },
        intangible: { cov: 0.40 }
      }
    });
    setShowSquadModal(true);
  };

  const openEditSquadModal = (squad) => {
    setEditingSquad(squad);
    setFormData({ ...squad });
    setShowSquadModal(true);
  };

  const saveSquad = () => {
    if (!formData.name) {
      showToast('❌ Informe o nome da squad');
      return;
    }

    const squadData = {
      ...formData,
      id: editingSquad ? editingSquad.id : generateId(),
      throughput: parseFloat(formData.throughput) || 7,
      leadTime: parseInt(formData.leadTime) || 14,
      wipLimit: parseInt(formData.wipLimit) || 5,
      wipAtual: parseInt(formData.wipAtual) || 0
    };

    if (editingSquad) {
      setSquads(prev => prev.map(s => s.id === editingSquad.id ? squadData : s));
      showToast('✅ Squad atualizada');
    } else {
      setSquads(prev => [...prev, squadData]);
      showToast('✅ Squad adicionada');
    }
    setShowSquadModal(false);
  };

  const deleteSquad = (id) => {
    if (!window.confirm('Deletar esta squad?')) return;
    setSquads(prev => prev.filter(s => s.id !== id));
    setItems(prev => prev.map(item => ({
      ...item,
      squadAllocations: (item.squadAllocations || []).filter(a => a.squadId !== id)
    })));
    showToast('🗑️ Squad removida');
  };

  // ============================================================================
  // ITEM FUNCTIONS
  // ============================================================================
  
  const openAddItemModal = (type = 'epic', parentId = null) => {
    if (squads.length === 0) {
      showToast('❌ Adicione uma squad primeiro');
      return;
    }
    setEditingItem(null);
    setFormData({
      name: '',
      type,
      serviceClass: 'standard',
      workType: 'new_feature',
      priority: items.length + 1,
      parentId,
      squadAllocations: [{ squadId: squads[0].id, issues: 10, startDate: null }],
      dependencies: [],
      flags: []
    });
    setShowItemModal(true);
  };

  const openEditItemModal = (item) => {
    setEditingItem(item);
    setFormData({ ...item });
    setShowItemModal(true);
  };

  const saveItem = () => {
    if (!formData.name) {
      showToast('❌ Informe o nome do item');
      return;
    }

    const itemData = {
      ...formData,
      id: editingItem ? editingItem.id : generateId(),
      selected: formData.selected !== undefined ? formData.selected : true,
      priority: parseInt(formData.priority) || 999,
      completedIssues: parseInt(formData.completedIssues) || 0,
      squadAllocations: (formData.squadAllocations || []).map(a => ({
        ...a,
        issues: parseInt(a.issues) || 10,
        squadId: typeof a.squadId === 'string' ? parseFloat(a.squadId) : a.squadId
      }))
    };

    if (editingItem) {
      setItems(prev => prev.map(i => i.id === editingItem.id ? itemData : i));
      showToast('✅ Item atualizado');
    } else {
      setItems(prev => [...prev, itemData]);
      showToast('✅ Item adicionado');
    }
    setShowItemModal(false);
  };

  const deleteItem = (id) => {
    if (!window.confirm('Deletar este item?')) return;
    // Remove o item e suas dependências de outros itens
    setItems(prev => prev
      .filter(i => i.id !== id)
      .map(i => ({
        ...i,
        parentId: i.parentId === id ? null : i.parentId,
        dependencies: (i.dependencies || []).filter(d => d.targetId !== id)
      }))
    );
    showToast('🗑️ Item removido');
  };

  const toggleItemSelection = (id) => {
    setItems(prev => prev.map(i => 
      i.id === id ? { ...i, selected: !i.selected } : i
    ));
  };

  // Allocation helpers
  const addAllocation = () => {
    if (squads.length === 0) return;
    setFormData(prev => ({
      ...prev,
      squadAllocations: [
        ...(prev.squadAllocations || []),
        { squadId: squads[0].id, issues: 10, startDate: null }
      ]
    }));
  };

  const updateAllocation = (index, field, value) => {
    setFormData(prev => {
      const allocs = [...(prev.squadAllocations || [])];
      allocs[index] = { ...allocs[index], [field]: value };
      return { ...prev, squadAllocations: allocs };
    });
  };

  const removeAllocation = (index) => {
    setFormData(prev => ({
      ...prev,
      squadAllocations: (prev.squadAllocations || []).filter((_, i) => i !== index)
    }));
  };

  // Dependency helpers
  const addDependency = () => {
    setFormData(prev => ({
      ...prev,
      dependencies: [
        ...(prev.dependencies || []),
        { targetId: null, type: 'blockedBy' }
      ]
    }));
  };

  const updateDependency = (index, field, value) => {
    setFormData(prev => {
      const deps = [...(prev.dependencies || [])];
      deps[index] = { ...deps[index], [field]: field === 'targetId' ? parseFloat(value) : value };
      return { ...prev, dependencies: deps };
    });
  };

  const removeDependency = (index) => {
    setFormData(prev => ({
      ...prev,
      dependencies: (prev.dependencies || []).filter((_, i) => i !== index)
    }));
  };

  // ============================================================================
  // SIMULAÇÃO MONTE CARLO
  // ============================================================================
  
  const runSimulation = useCallback(() => {
    if (selectedItems.length === 0) {
      showToast('❌ Selecione itens para simular');
      return;
    }
    if (squads.length === 0) {
      showToast('❌ Adicione squads');
      return;
    }

    const numSims = config.simulations;
    const projections = [];
    const allResults = [];

    // Para cada item selecionado
    selectedItems.forEach(item => {
      (item.squadAllocations || []).forEach(alloc => {
        const squad = squads.find(s => s.id === alloc.squadId);
        if (!squad || !alloc.issues) return;

        const cov = squad.classMetrics?.[item.serviceClass]?.cov || 
                    SERVICE_CLASSES[item.serviceClass]?.defaultCoV || 0.30;

        const sim = monteCarloSimulation(alloc.issues, squad.throughput, cov, numSims);
        
        const startWeeks = dateToWeeks(alloc.startDate);
        
        projections.push({
          item,
          squad,
          issues: alloc.issues,
          startDate: alloc.startDate,
          startWeeks,
          p5: startWeeks + sim.p5,
          p50: startWeeks + sim.p50,
          p85: startWeeks + sim.p85,
          p95: startWeeks + sim.p95,
          cov
        });

        sim.results.forEach(r => allResults.push(startWeeks + r));
      });
    });

    // Ordena resultados agregados
    allResults.sort((a, b) => a - b);
    
    const p5 = allResults[Math.floor(allResults.length * 0.05)] || 0;
    const p50 = allResults[Math.floor(allResults.length * 0.50)] || 0;
    const p85 = allResults[Math.floor(allResults.length * 0.85)] || 0;
    const p95 = allResults[Math.floor(allResults.length * 0.95)] || 0;

    const originalTotal = selectedItems.reduce((sum, i) => sum + getTotalIssues(i), 0);

    setResults({
      projections,
      allResults,
      p5, p50, p85, p95,
      numSims,
      originalTotal
    });

    setCurrentView('results');
    showToast('✅ Simulação concluída');
  }, [selectedItems, squads, config.simulations, showToast]);

  // ============================================================================
  // SIMULAÇÃO DE AGENDAMENTO
  // ============================================================================
  
  const runScheduleSimulation = useCallback(() => {
    if (selectedItems.length === 0) {
      showToast('❌ Selecione itens para agendar');
      return;
    }

    const targetLoadFactor = config.targetLoad / 100;
    const weekLoads = new Map();
    const epicEndDates = new Map();
    const proposals = [];

    // Ordena por dependências e prioridade
    const { sorted, levels } = topologicalSortWithPriority(selectedItems);

    // Para cada item (na ordem correta)
    sorted.forEach(item => {
      (item.squadAllocations || []).forEach(alloc => {
        const squad = squads.find(s => s.id === alloc.squadId);
        if (!squad || !alloc.issues) return;

        // Calcula semana mínima (dependências)
        let minWeek = 0;
        if (config.respectDependencies) {
          minWeek = calculateEarliestStart(item, items, epicEndDates);
        }

        // Se tem data definida, usa a maior entre data e dependência
        if (alloc.startDate) {
          minWeek = Math.max(minWeek, dateToWeeks(alloc.startDate));
        }

        // Bin packing
        const { startWeek, endWeek } = binPackingAllocation(
          squad, 
          Math.ceil(minWeek), 
          alloc.issues, 
          weekLoads, 
          targetLoadFactor
        );

        // Registra fim para dependências
        if (endWeek > (epicEndDates.get(String(item.id)) || 0)) {
          epicEndDates.set(String(item.id), endWeek);
        }

        // Calcula data proposta
        const weeks = generateWeeks(104);
        const proposedDate = startWeek >= 0 && weeks[startWeek] 
          ? weeks[startWeek].start.toISOString().split('T')[0]
          : null;

        // Verifica se mudou
        const hasChanged = proposedDate !== alloc.startDate;

        proposals.push({
          itemId: item.id,
          itemName: item.name,
          itemType: item.type,
          squadId: squad.id,
          squadName: squad.name,
          squadColor: squad.color,
          currentDate: alloc.startDate,
          proposedDate,
          proposedStartWeek: startWeek,
          proposedEndWeek: endWeek,
          hasChanged,
          selected: hasChanged,
          level: levels.get(item.id) || 0,
          blockedBy: (item.dependencies || [])
            .filter(d => d.type === 'blockedBy')
            .map(d => items.find(i => i.id === d.targetId)?.name)
            .filter(Boolean)
            .join(', ')
        });
      });
    });

    setScheduleProposals(proposals);
    setShowScheduleModal(true);
  }, [selectedItems, items, squads, config]);

  const applyScheduleProposals = () => {
    const selected = scheduleProposals.filter(p => p.selected && p.hasChanged);
    
    if (selected.length === 0) {
      showToast('⚠️ Nenhuma alteração selecionada');
      return;
    }

    setItems(prev => prev.map(item => {
      const proposal = selected.find(p => p.itemId === item.id);
      if (!proposal) return item;

      return {
        ...item,
        squadAllocations: (item.squadAllocations || []).map(alloc => {
          if (alloc.squadId === proposal.squadId) {
            return { ...alloc, startDate: proposal.proposedDate };
          }
          return alloc;
        })
      };
    }));

    setShowScheduleModal(false);
    showToast(`✅ ${selected.length} alterações aplicadas`);

    // Re-simula Monte Carlo se configurado
    if (config.autoSimulate) {
      setTimeout(() => runSimulation(), 500);
    }
  };

  // ============================================================================
  // EXPORT/IMPORT
  // ============================================================================
  
  const exportData = () => {
    const data = { squads, items, config, exportDate: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roadmap-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('💾 Dados exportados');
  };

  const importData = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.squads) setSquads(data.squads);
        if (data.items) setItems(data.items);
        if (data.config) setConfig(prev => ({ ...prev, ...data.config }));
        showToast('✅ Dados importados');
      } catch {
        showToast('❌ Arquivo inválido');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const clearAllData = () => {
    if (!window.confirm('Limpar TODOS os dados?')) return;
    setSquads([]);
    setItems([]);
    setResults(null);
    localStorage.removeItem('roadmap_data_v2');
    showToast('🗑️ Dados limpos');
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  
  return (
    <div className="app">
      {/* Toast */}
      {toast && <div className="toast show">{toast}</div>}

      {/* Header */}
      <header className="header">
        <div className="header-content">
          <h1>🎯 Roadmap Forecaster Pro</h1>
          <p>Projeção Monte Carlo Multi-Squad • {config.simulations.toLocaleString()} iterações</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={exportData}>💾 Exportar</button>
          <label className="btn btn-secondary">
            📁 Importar
            <input type="file" accept=".json" onChange={importData} style={{display: 'none'}} />
          </label>
          <button className="btn btn-danger-outline" onClick={clearAllData}>🗑️</button>
        </div>
      </header>

      {/* View Selector */}
      <nav className="view-selector">
        <button className={`view-btn ${currentView === 'planning' ? 'active' : ''}`} onClick={() => setCurrentView('planning')}>
          📋 Planejamento
        </button>
        <button className={`view-btn ${currentView === 'queue' ? 'active' : ''}`} onClick={() => setCurrentView('queue')}>
          📊 Filas (PCP)
        </button>
        <button className={`view-btn ${currentView === 'timeline' ? 'active' : ''}`} onClick={() => setCurrentView('timeline')}>
          📅 Timeline
        </button>
        <button className={`view-btn ${currentView === 'heatmap' ? 'active' : ''}`} onClick={() => setCurrentView('heatmap')}>
          🔥 Heatmap
        </button>
        <button className={`view-btn ${currentView === 'results' ? 'active' : ''}`} onClick={() => setCurrentView('results')}>
          📈 Resultados
        </button>
      </nav>

      {/* =========== PLANNING VIEW =========== */}
      {currentView === 'planning' && (
        <div className="main-grid">
          {/* Squads */}
          <div className="card">
            <div className="card-header">
              <h2>👥 Squads ({squads.length})</h2>
              <button className="btn btn-primary btn-sm" onClick={openAddSquadModal}>+ Squad</button>
            </div>
            {squads.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">👥</div>
                <p>Nenhuma squad</p>
              </div>
            ) : (
              <div className="squads-grid">
                {squads.map(squad => {
                  const wipIdeal = calculateWipIdeal(squad);
                  const wipStatus = getWipStatus(squad);
                  return (
                    <div key={squad.id} className="squad-card">
                      <div className="squad-header">
                        <div className="squad-name">
                          <span className="squad-color" style={{background: squad.color}} />
                          {squad.name}
                        </div>
                        <div className="squad-actions">
                          <button className="btn-icon" onClick={() => openEditSquadModal(squad)}>✏️</button>
                          <button className="btn-icon danger" onClick={() => deleteSquad(squad.id)}>✕</button>
                        </div>
                      </div>
                      <div className="squad-metrics-grid">
                        <div className="squad-metric-item">
                          <div className="squad-metric-label">Throughput</div>
                          <div className="squad-metric-value">{squad.throughput}</div>
                          <div className="squad-metric-sub">/semana</div>
                        </div>
                        <div className="squad-metric-item">
                          <div className="squad-metric-label">Lead Time</div>
                          <div className="squad-metric-value">{squad.leadTime}</div>
                          <div className="squad-metric-sub">dias</div>
                        </div>
                        <div className="squad-metric-item">
                          <div className="squad-metric-label">WIP</div>
                          <div className={`squad-metric-value ${wipStatus}`}>{squad.wipAtual}/{wipIdeal}</div>
                          <div className="squad-metric-sub">atual/ideal</div>
                        </div>
                        <div className="squad-metric-item">
                          <div className="squad-metric-label">Limite</div>
                          <div className="squad-metric-value">{squad.wipLimit}</div>
                          <div className="squad-metric-sub">WIP max</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Items */}
          <div className="card">
            <div className="card-header">
              <h2>📋 Itens ({items.length})</h2>
              <div className="btn-group">
                <button className="btn btn-primary btn-sm" onClick={() => openAddItemModal('initiative')}>+ Iniciativa</button>
                <button className="btn btn-primary btn-sm" onClick={() => openAddItemModal('epic')}>+ Épico</button>
              </div>
            </div>
            {items.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📋</div>
                <p>Nenhum item</p>
              </div>
            ) : (
              <div className="list">
                {items.filter(i => !i.parentId).map(item => (
                  <ItemRow 
                    key={item.id}
                    item={item}
                    items={items}
                    squads={squads}
                    onToggle={toggleItemSelection}
                    onEdit={openEditItemModal}
                    onDelete={deleteItem}
                    onAddChild={openAddItemModal}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Simulation Controls */}
          <div className="card full-width">
            <div className="card-header">
              <h2>🎲 Simulação</h2>
              <div className="simulation-controls">
                <label className="config-label">
                  <input 
                    type="checkbox" 
                    checked={config.autoSimulate}
                    onChange={e => setConfig({...config, autoSimulate: e.target.checked})}
                  />
                  Auto-simular
                </label>
                <label className="config-label">
                  Iterações:
                  <select
                    value={config.simulations}
                    onChange={e => setConfig({...config, simulations: parseInt(e.target.value)})}
                    className="config-select"
                  >
                    <option value={1000}>1.000</option>
                    <option value={5000}>5.000</option>
                    <option value={10000}>10.000</option>
                    <option value={50000}>50.000</option>
                  </select>
                </label>
                <label className="config-label">
                  Carga Alvo:
                  <select
                    value={config.targetLoad}
                    onChange={e => setConfig({...config, targetLoad: parseInt(e.target.value)})}
                    className="config-select"
                  >
                    <option value={70}>70%</option>
                    <option value={85}>85%</option>
                    <option value={100}>100%</option>
                    <option value={120}>120%</option>
                    <option value={150}>150%</option>
                  </select>
                </label>
                <button 
                  className="btn btn-success" 
                  onClick={runSimulation}
                  disabled={selectedItems.length === 0}
                >
                  🚀 Simular ({selectedItems.length} itens, {totalSelectedIssues} issues)
                </button>
                <button 
                  className="btn btn-primary" 
                  onClick={runScheduleSimulation}
                  disabled={selectedItems.length === 0}
                >
                  📅 Agendar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========== QUEUE VIEW (PCP) =========== */}
      {currentView === 'queue' && (
        <QueueView 
          squads={squads}
          items={items}
          selectedItems={selectedItems}
          onEditItem={openEditItemModal}
        />
      )}

      {/* =========== TIMELINE VIEW =========== */}
      {currentView === 'timeline' && (
        <TimelineView 
          squads={squads}
          items={items}
          selectedItems={selectedItems}
          config={config}
        />
      )}

      {/* =========== HEATMAP VIEW =========== */}
      {currentView === 'heatmap' && (
        <HeatmapView 
          squads={squads}
          items={items}
          selectedItems={selectedItems}
        />
      )}

      {/* =========== RESULTS VIEW =========== */}
      {currentView === 'results' && (
        <ResultsView 
          results={results}
          squads={squads}
          onRunSimulation={runSimulation}
        />
      )}

      {/* =========== MODALS =========== */}
      
      {/* Squad Modal */}
      {showSquadModal && (
        <Modal title={editingSquad ? '✏️ Editar Squad' : '➕ Nova Squad'} onClose={() => setShowSquadModal(false)}>
          <div className="form-group">
            <label>Nome *</label>
            <input
              type="text"
              value={formData.name || ''}
              onChange={e => setFormData({...formData, name: e.target.value})}
              placeholder="Ex: Squad Alpha"
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Throughput (issues/sem)</label>
              <input
                type="number"
                value={formData.throughput || ''}
                onChange={e => setFormData({...formData, throughput: e.target.value})}
                min="0.1" step="0.5"
              />
            </div>
            <div className="form-group">
              <label>Lead Time (dias)</label>
              <input
                type="number"
                value={formData.leadTime || ''}
                onChange={e => setFormData({...formData, leadTime: e.target.value})}
                min="1"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>WIP Atual</label>
              <input
                type="number"
                value={formData.wipAtual || ''}
                onChange={e => setFormData({...formData, wipAtual: e.target.value})}
                min="0"
              />
            </div>
            <div className="form-group">
              <label>WIP Limite</label>
              <input
                type="number"
                value={formData.wipLimit || ''}
                onChange={e => setFormData({...formData, wipLimit: e.target.value})}
                min="1"
              />
            </div>
          </div>
          <div className="form-group">
            <label>CoV por Classe de Serviço</label>
            <div className="cov-grid">
              {Object.entries(SERVICE_CLASSES).map(([key, cls]) => (
                <div key={key} className="cov-item">
                  <span>{cls.icon} {cls.name}</span>
                  <input
                    type="number"
                    value={formData.classMetrics?.[key]?.cov || cls.defaultCoV}
                    onChange={e => setFormData({
                      ...formData,
                      classMetrics: {
                        ...formData.classMetrics,
                        [key]: { cov: parseFloat(e.target.value) || cls.defaultCoV }
                      }
                    })}
                    min="0" max="1" step="0.05"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>Cor</label>
            <div className="color-picker">
              {SQUAD_COLORS.map(color => (
                <div
                  key={color}
                  className={`color-option ${formData.color === color ? 'selected' : ''}`}
                  style={{background: color}}
                  onClick={() => setFormData({...formData, color})}
                />
              ))}
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setShowSquadModal(false)}>Cancelar</button>
            <button className="btn btn-primary" onClick={saveSquad}>Salvar</button>
          </div>
        </Modal>
      )}

      {/* Item Modal */}
      {showItemModal && (
        <Modal 
          title={editingItem ? `✏️ Editar ${ITEM_TYPES[formData.type]?.name || 'Item'}` : `➕ ${ITEM_TYPES[formData.type]?.name || 'Novo Item'}`} 
          onClose={() => setShowItemModal(false)}
          large
        >
          <div className="form-group">
            <label>Nome *</label>
            <input
              type="text"
              value={formData.name || ''}
              onChange={e => setFormData({...formData, name: e.target.value})}
              placeholder="Ex: Implementar Login SSO"
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Tipo</label>
              <select
                value={formData.type || 'epic'}
                onChange={e => setFormData({...formData, type: e.target.value})}
              >
                {Object.entries(ITEM_TYPES).map(([key, t]) => (
                  <option key={key} value={key}>{t.icon} {t.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Classe de Serviço</label>
              <select
                value={formData.serviceClass || 'standard'}
                onChange={e => setFormData({...formData, serviceClass: e.target.value})}
              >
                {Object.entries(SERVICE_CLASSES).map(([key, cls]) => (
                  <option key={key} value={key}>{cls.icon} {cls.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Tipo de Trabalho</label>
              <select
                value={formData.workType || 'new_feature'}
                onChange={e => setFormData({...formData, workType: e.target.value})}
              >
                {Object.entries(WORK_TYPES).map(([key, wt]) => (
                  <option key={key} value={key}>{wt.icon} {wt.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Prioridade</label>
              <input
                type="number"
                value={formData.priority || ''}
                onChange={e => setFormData({...formData, priority: e.target.value})}
                min="1"
              />
            </div>
            <div className="form-group">
              <label>Item Pai</label>
              <select
                value={formData.parentId || ''}
                onChange={e => setFormData({...formData, parentId: e.target.value ? parseFloat(e.target.value) : null})}
              >
                <option value="">Nenhum</option>
                {items.filter(i => i.id !== formData.id && ITEM_TYPES[i.type]?.level < ITEM_TYPES[formData.type]?.level).map(i => (
                  <option key={i.id} value={i.id}>{ITEM_TYPES[i.type]?.icon} {i.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Issues Concluídas</label>
              <input
                type="number"
                value={formData.completedIssues || 0}
                onChange={e => setFormData({...formData, completedIssues: e.target.value})}
                min="0"
              />
            </div>
          </div>

          {/* Alocações */}
          <div className="form-section">
            <div className="section-header">
              <label>Alocação de Squads</label>
              <button className="btn-small btn-primary" onClick={addAllocation}>+ Squad</button>
            </div>
            {(formData.squadAllocations || []).map((alloc, idx) => (
              <div key={idx} className="allocation-row">
                <select
                  value={alloc.squadId || ''}
                  onChange={e => updateAllocation(idx, 'squadId', e.target.value)}
                >
                  {squads.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  value={alloc.issues || ''}
                  onChange={e => updateAllocation(idx, 'issues', e.target.value)}
                  placeholder="Issues"
                  min="1"
                />
                <input
                  type="date"
                  value={alloc.startDate || ''}
                  onChange={e => updateAllocation(idx, 'startDate', e.target.value || null)}
                />
                {(formData.squadAllocations || []).length > 1 && (
                  <button className="btn-icon danger" onClick={() => removeAllocation(idx)}>✕</button>
                )}
              </div>
            ))}
            <div className="allocation-total">
              Total: {(formData.squadAllocations || []).reduce((sum, a) => sum + (parseInt(a.issues) || 0), 0)} issues
            </div>
          </div>

          {/* Dependências */}
          <div className="form-section">
            <div className="section-header">
              <label>Dependências</label>
              <button className="btn-small btn-primary" onClick={addDependency}>+ Dependência</button>
            </div>
            {(formData.dependencies || []).map((dep, idx) => (
              <div key={idx} className="dependency-row">
                <select
                  value={dep.type || 'blockedBy'}
                  onChange={e => updateDependency(idx, 'type', e.target.value)}
                >
                  {Object.entries(DEPENDENCY_TYPES).map(([key, dt]) => (
                    <option key={key} value={key}>{dt.icon} {dt.name}</option>
                  ))}
                </select>
                <select
                  value={dep.targetId || ''}
                  onChange={e => updateDependency(idx, 'targetId', e.target.value)}
                >
                  <option value="">Selecione...</option>
                  {items.filter(i => i.id !== formData.id).map(i => (
                    <option key={i.id} value={i.id}>{ITEM_TYPES[i.type]?.icon} {i.name}</option>
                  ))}
                </select>
                <button className="btn-icon danger" onClick={() => removeDependency(idx)}>✕</button>
              </div>
            ))}
          </div>

          <div className="modal-footer">
            <button className="btn" onClick={() => setShowItemModal(false)}>Cancelar</button>
            <button className="btn btn-primary" onClick={saveItem}>Salvar</button>
          </div>
        </Modal>
      )}

      {/* Schedule Modal */}
      {showScheduleModal && (
        <Modal title="📅 Simulação de Agendamento" onClose={() => setShowScheduleModal(false)} large>
          <div className="schedule-summary">
            <div className="schedule-stat">
              <span className="stat-value">{scheduleProposals.length}</span>
              <span className="stat-label">Total</span>
            </div>
            <div className="schedule-stat">
              <span className="stat-value">{scheduleProposals.filter(p => p.hasChanged).length}</span>
              <span className="stat-label">Alterações</span>
            </div>
            <div className="schedule-stat success">
              <span className="stat-value">{scheduleProposals.filter(p => p.hasChanged && p.proposedStartWeek < dateToWeeks(p.currentDate)).length}</span>
              <span className="stat-label">Antecipados</span>
            </div>
            <div className="schedule-stat danger">
              <span className="stat-value">{scheduleProposals.filter(p => p.hasChanged && p.proposedStartWeek > dateToWeeks(p.currentDate)).length}</span>
              <span className="stat-label">Adiados</span>
            </div>
          </div>
          
          <div className="schedule-table-container">
            <table className="schedule-table">
              <thead>
                <tr>
                  <th><input type="checkbox" onChange={e => setScheduleProposals(prev => prev.map(p => ({...p, selected: p.hasChanged && e.target.checked})))} /></th>
                  <th>Item</th>
                  <th>Squad</th>
                  <th>Bloqueado por</th>
                  <th>Data Atual</th>
                  <th>→</th>
                  <th>Data Sugerida</th>
                </tr>
              </thead>
              <tbody>
                {scheduleProposals.map((p, idx) => (
                  <tr key={idx} className={!p.hasChanged ? 'no-change' : ''}>
                    <td>
                      <input 
                        type="checkbox" 
                        checked={p.selected}
                        disabled={!p.hasChanged}
                        onChange={e => setScheduleProposals(prev => prev.map((pp, i) => i === idx ? {...pp, selected: e.target.checked} : pp))}
                      />
                    </td>
                    <td>
                      <span className="item-type-icon">{ITEM_TYPES[p.itemType]?.icon}</span>
                      {p.itemName}
                    </td>
                    <td>
                      <span className="squad-indicator">
                        <span className="color-dot-small" style={{background: p.squadColor}} />
                        {p.squadName}
                      </span>
                    </td>
                    <td className="blocked-by">{p.blockedBy || '—'}</td>
                    <td>{p.currentDate ? new Date(p.currentDate).toLocaleDateString('pt-BR') : '—'}</td>
                    <td>{p.hasChanged ? '→' : ''}</td>
                    <td className={p.hasChanged ? 'changed' : ''}>{p.proposedDate ? new Date(p.proposedDate).toLocaleDateString('pt-BR') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="modal-footer">
            <label className="config-label">
              <input 
                type="checkbox" 
                checked={config.autoSimulate}
                onChange={e => setConfig({...config, autoSimulate: e.target.checked})}
              />
              Ressimular Monte Carlo após aplicar
            </label>
            <button className="btn" onClick={() => setShowScheduleModal(false)}>Cancelar</button>
            <button className="btn btn-success" onClick={applyScheduleProposals}>
              ✓ Aplicar ({scheduleProposals.filter(p => p.selected && p.hasChanged).length})
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTES
// ============================================================================

// Modal Component
function Modal({ title, children, onClose, large }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${large ? 'modal-large' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// Item Row Component (recursive)
function ItemRow({ item, items, squads, onToggle, onEdit, onDelete, onAddChild, level = 0 }) {
  const [expanded, setExpanded] = useState(true);
  const children = items.filter(i => i.parentId === item.id);
  const hasChildren = children.length > 0;
  const typeInfo = ITEM_TYPES[item.type];
  const classInfo = SERVICE_CLASSES[item.serviceClass];
  const totalIssues = getTotalIssues(item);
  const progress = getProgress(item);
  
  const deps = (item.dependencies || []).filter(d => d.type === 'blockedBy');
  
  return (
    <>
      <div className={`list-item ${item.selected ? 'selected' : ''}`} style={{paddingLeft: `${16 + level * 24}px`}}>
        {hasChildren && (
          <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
            {expanded ? '▼' : '▶'}
          </button>
        )}
        <div className="list-item-checkbox">
          <input type="checkbox" checked={item.selected || false} onChange={() => onToggle(item.id)} />
        </div>
        <div className="list-item-content">
          <div className="list-item-title">
            <span className={`service-badge badge-${item.serviceClass}`}>{classInfo?.icon}</span>
            <span>{typeInfo?.icon}</span>
            <span>{item.name}</span>
            {deps.length > 0 && <span className="dep-badge">🔗 {deps.length}</span>}
          </div>
          <div className="list-item-meta">
            {totalIssues} issues
            {item.completedIssues > 0 && ` • ${progress}% concluído`}
            {(item.squadAllocations || []).map((alloc, idx) => {
              const squad = squads.find(s => s.id === alloc.squadId);
              return squad ? (
                <span key={idx} className="allocation-tag">
                  <span className="color-dot-small" style={{background: squad.color}} />
                  {squad.name}
                </span>
              ) : null;
            })}
          </div>
        </div>
        <div className="list-item-actions">
          {typeInfo?.level < 2 && (
            <button className="btn-small" onClick={() => onAddChild(typeInfo?.level === 0 ? 'epic' : 'issue', item.id)}>+</button>
          )}
          <button className="btn-small" onClick={() => onEdit(item)}>✏️</button>
          <button className="btn-small btn-danger" onClick={() => onDelete(item.id)}>🗑️</button>
        </div>
      </div>
      {expanded && children.map(child => (
        <ItemRow
          key={child.id}
          item={child}
          items={items}
          squads={squads}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddChild={onAddChild}
          level={level + 1}
        />
      ))}
    </>
  );
}

// Queue View Component (PCP - Filas Verticais)
function QueueView({ squads, items, selectedItems, onEditItem }) {
  return (
    <div className="queue-view">
      <div className="queue-container">
        <div className="queue-main">
          {squads.map(squad => {
            const squadItems = selectedItems
              .filter(i => (i.squadAllocations || []).some(a => a.squadId === squad.id))
              .sort((a, b) => (a.priority || 999) - (b.priority || 999));
            
            const wipIdeal = calculateWipIdeal(squad);
            const wipStatus = getWipStatus(squad);
            
            return (
              <div key={squad.id} className="queue-column">
                <div className="queue-column-header">
                  <div className="queue-column-title">
                    <span className="squad-dot" style={{background: squad.color}} />
                    {squad.name}
                  </div>
                  <div className="queue-column-metrics">
                    <div className="queue-metric">
                      <div className="queue-metric-label">TP</div>
                      <div className="queue-metric-value">{squad.throughput}/sem</div>
                    </div>
                    <div className="queue-metric">
                      <div className="queue-metric-label">WIP</div>
                      <div className={`queue-metric-value ${wipStatus}`}>{squad.wipAtual}/{wipIdeal}</div>
                    </div>
                  </div>
                </div>
                <div className="queue-column-body">
                  {squadItems.length === 0 ? (
                    <div className="queue-empty">
                      <div className="queue-empty-icon">📭</div>
                      <div>Sem itens</div>
                    </div>
                  ) : (
                    squadItems.map((item, idx) => {
                      const alloc = (item.squadAllocations || []).find(a => a.squadId === squad.id);
                      const typeInfo = ITEM_TYPES[item.type];
                      const classInfo = SERVICE_CLASSES[item.serviceClass];
                      const deps = (item.dependencies || []).filter(d => d.type === 'blockedBy');
                      
                      return (
                        <div key={item.id} className="queue-item" onClick={() => onEditItem(item)}>
                          <div className="queue-item-position">{idx + 1}</div>
                          <div className="queue-item-header">
                            <span className="queue-item-type">{typeInfo?.icon}</span>
                            <div className="queue-item-info">
                              <div className="queue-item-name">{item.name}</div>
                              <div className="queue-item-meta">
                                <span className={`queue-item-badge badge-${item.serviceClass}`}>{classInfo?.icon} {classInfo?.name}</span>
                                <span>{alloc?.issues || 0} issues</span>
                              </div>
                              {deps.length > 0 && (
                                <div className="queue-item-deps">
                                  🔗 Bloqueado por {deps.length} item(s)
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Timeline View Component (Gantt simplificado)
function TimelineView({ squads, items, selectedItems, config }) {
  const weeks = generateWeeks(26);
  
  return (
    <div className="timeline-view">
      <div className="card full-width">
        <h2>📅 Timeline (Gantt)</h2>
        <div className="timeline-container">
          <div className="timeline-header-row">
            <div className="timeline-label-cell">Squad / Item</div>
            {weeks.slice(0, 12).map(w => (
              <div key={w.index} className="timeline-week-cell">{w.label}</div>
            ))}
          </div>
          
          {squads.map(squad => {
            const squadItems = selectedItems
              .filter(i => (i.squadAllocations || []).some(a => a.squadId === squad.id))
              .sort((a, b) => (a.priority || 999) - (b.priority || 999));
            
            return (
              <div key={squad.id} className="timeline-squad-section">
                <div className="timeline-squad-header">
                  <span className="squad-dot" style={{background: squad.color}} />
                  {squad.name}
                </div>
                {squadItems.map(item => {
                  const alloc = (item.squadAllocations || []).find(a => a.squadId === squad.id);
                  const startWeek = alloc?.startDate ? Math.floor(dateToWeeks(alloc.startDate)) : 0;
                  const duration = Math.ceil((alloc?.issues || 0) / squad.throughput);
                  const typeInfo = ITEM_TYPES[item.type];
                  
                  return (
                    <div key={item.id} className="timeline-item-row">
                      <div className="timeline-label-cell">
                        {typeInfo?.icon} {item.name.substring(0, 20)}...
                      </div>
                      {weeks.slice(0, 12).map(w => {
                        const isActive = w.index >= startWeek && w.index < startWeek + duration;
                        return (
                          <div key={w.index} className={`timeline-week-cell ${isActive ? 'active' : ''}`}>
                            {isActive && (
                              <div className="timeline-bar" style={{background: squad.color}} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Heatmap View Component
function HeatmapView({ squads, items, selectedItems }) {
  const weeks = generateWeeks(12);
  
  // Calcula carga por squad/semana
  const loadMap = useMemo(() => {
    const map = new Map();
    
    selectedItems.forEach(item => {
      (item.squadAllocations || []).forEach(alloc => {
        const squad = squads.find(s => s.id === alloc.squadId);
        if (!squad) return;
        
        const startWeek = alloc.startDate ? Math.floor(dateToWeeks(alloc.startDate)) : 0;
        const duration = Math.ceil((alloc.issues || 0) / squad.throughput);
        const issuesPerWeek = (alloc.issues || 0) / duration;
        
        for (let w = startWeek; w < startWeek + duration && w < 12; w++) {
          const key = `${squad.id}-${w}`;
          map.set(key, (map.get(key) || 0) + issuesPerWeek);
        }
      });
    });
    
    return map;
  }, [selectedItems, squads]);
  
  const getHeatColor = (load, capacity) => {
    const ratio = load / capacity;
    if (ratio < 0.5) return '#dbeafe'; // Azul claro
    if (ratio < 0.85) return '#dcfce7'; // Verde
    if (ratio <= 1) return '#fef9c3'; // Amarelo
    return '#fee2e2'; // Vermelho
  };
  
  return (
    <div className="heatmap-view">
      <div className="card full-width">
        <h2>🔥 Heatmap de Carga</h2>
        <div className="heatmap-container">
          <div className="heatmap-header-row">
            <div className="heatmap-label-cell">Squad</div>
            {weeks.map(w => (
              <div key={w.index} className="heatmap-week-cell">{w.label}</div>
            ))}
          </div>
          
          {squads.map(squad => (
            <div key={squad.id} className="heatmap-row">
              <div className="heatmap-label-cell">
                <span className="squad-dot" style={{background: squad.color}} />
                {squad.name}
              </div>
              {weeks.map(w => {
                const load = loadMap.get(`${squad.id}-${w.index}`) || 0;
                const ratio = load / squad.throughput;
                
                return (
                  <div 
                    key={w.index} 
                    className="heatmap-cell"
                    style={{background: getHeatColor(load, squad.throughput)}}
                    title={`${load.toFixed(1)} / ${squad.throughput} (${Math.round(ratio * 100)}%)`}
                  >
                    {load > 0 && <span>{Math.round(ratio * 100)}%</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        
        <div className="heatmap-legend">
          <span><span className="legend-dot" style={{background: '#dbeafe'}} /> &lt;50%</span>
          <span><span className="legend-dot" style={{background: '#dcfce7'}} /> 50-85%</span>
          <span><span className="legend-dot" style={{background: '#fef9c3'}} /> 85-100%</span>
          <span><span className="legend-dot" style={{background: '#fee2e2'}} /> &gt;100%</span>
        </div>
      </div>
    </div>
  );
}

// Results View Component
function ResultsView({ results, squads, onRunSimulation }) {
  if (!results) {
    return (
      <div className="results-view">
        <div className="card full-width">
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <p>Nenhum resultado</p>
            <button className="btn btn-primary" onClick={onRunSimulation}>🚀 Executar Simulação</button>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="results-view">
      {/* Summary */}
      <div className="card full-width results-summary">
        <h2>📊 Resultados Monte Carlo</h2>
        <p className="results-subtitle">{results.numSims.toLocaleString()} simulações • {results.projections.length} projeções</p>
        
        <div className="results-grid">
          <div className="result-card">
            <div className="result-label">Original</div>
            <div className="result-value">{results.originalTotal}</div>
            <div className="result-sub">issues</div>
          </div>
          <div className="result-card highlight">
            <div className="result-label">P50</div>
            <div className="result-value">{results.p50.toFixed(1)}s</div>
            <div className="result-sub">{weeksToDate(results.p50)}</div>
          </div>
          <div className="result-card highlight">
            <div className="result-label">P85</div>
            <div className="result-value">{results.p85.toFixed(1)}s</div>
            <div className="result-sub">{weeksToDate(results.p85)}</div>
          </div>
          <div className="result-card">
            <div className="result-label">P95</div>
            <div className="result-value">{results.p95.toFixed(1)}s</div>
            <div className="result-sub">{weeksToDate(results.p95)}</div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="card full-width">
        <h3>📅 Linha do Tempo</h3>
        <div className="timeline-visual">
          <div className="timeline-header">
            <span>Hoje</span>
            <span>{results.p95.toFixed(1)} semanas</span>
          </div>
          <div className="timeline-bar-container">
            <div className="timeline-bar timeline-p50" style={{width: `${(results.p50 / results.p95) * 100}%`}}>P50</div>
            <div className="timeline-bar timeline-p85" style={{left: `${(results.p50 / results.p95) * 100}%`, width: `${((results.p85 - results.p50) / results.p95) * 100}%`}}>P85</div>
            <div className="timeline-bar timeline-p95" style={{left: `${(results.p85 / results.p95) * 100}%`, width: `${((results.p95 - results.p85) / results.p95) * 100}%`}}>P95</div>
          </div>
          <div className="percentile-markers">
            <div className="percentile-marker"><span className="marker-dot dot-p50" />P50: {results.p50.toFixed(1)}s ({weeksToDate(results.p50)})</div>
            <div className="percentile-marker"><span className="marker-dot dot-p85" />P85: {results.p85.toFixed(1)}s ({weeksToDate(results.p85)})</div>
            <div className="percentile-marker"><span className="marker-dot dot-p95" />P95: {results.p95.toFixed(1)}s ({weeksToDate(results.p95)})</div>
          </div>
        </div>
      </div>

      {/* Projection Table */}
      <div className="card full-width">
        <h3>📋 Projeções por Item</h3>
        <table className="projection-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Squad</th>
              <th>Classe</th>
              <th>CoV</th>
              <th>Issues</th>
              <th>P50</th>
              <th>P85</th>
              <th>P95</th>
            </tr>
          </thead>
          <tbody>
            {results.projections.map((p, idx) => (
              <tr key={idx}>
                <td><strong>{p.item.name}</strong></td>
                <td>
                  <span className="squad-indicator">
                    <span className="color-dot-small" style={{background: p.squad.color}} />
                    {p.squad.name}
                  </span>
                </td>
                <td><span className={`badge badge-${p.item.serviceClass}`}>{SERVICE_CLASSES[p.item.serviceClass]?.icon} {SERVICE_CLASSES[p.item.serviceClass]?.name}</span></td>
                <td>{(p.cov * 100).toFixed(0)}%</td>
                <td>{p.issues}</td>
                <td>{weeksToDate(p.p50)}</td>
                <td>{weeksToDate(p.p85)}</td>
                <td>{weeksToDate(p.p95)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Histogram */}
      <div className="card full-width">
        <h3>📊 Distribuição</h3>
        <div className="histogram">
          {(() => {
            const bins = new Array(30).fill(0);
            const binSize = (results.p95 - results.p5) / 30;
            results.allResults.forEach(r => {
              if (r >= results.p5 && r <= results.p95) {
                bins[Math.min(Math.floor((r - results.p5) / binSize), 29)]++;
              }
            });
            const maxBin = Math.max(...bins);
            return bins.map((c, i) => (
              <div key={i} className="histogram-bar" style={{height: `${(c / maxBin) * 100}%`}} />
            ));
          })()}
        </div>
        <div className="histogram-labels">
          <span>P5: {results.p5.toFixed(1)}s</span>
          <span>P50: {results.p50.toFixed(1)}s</span>
          <span>P95: {results.p95.toFixed(1)}s</span>
        </div>
      </div>
    </div>
  );
}

export default App;
