# ⚡ Guia Rápido - 5 Minutos

## 🎯 Do Zero ao Ar em 5 Minutos

### 1️⃣ Instalar Forge CLI (1 min)
```bash
npm install -g @forge/cli
forge login
```

### 2️⃣ Preparar Projeto (1 min)
```bash
tar -xzf roadmap-pro.tar.gz
cd roadmap-pro
npm install
```

### 3️⃣ Registrar & Deploy (2 min)
```bash
forge register
# Copie o App ID que aparecer

# Edite manifest.yml: substitua SUBSTITUIR-PELO-SEU-APP-ID pelo App ID

forge deploy
forge install
```

### 4️⃣ Usar no Jira (1 min)
1. Abra seu Jira
2. Vá para um Projeto
3. Menu lateral → **Roadmap Forecaster**
4. Pronto! 🎉

---

## 📸 Screenshots do Processo

### Passo 1: forge register
```
? Product category: Productivity
✔ Registered new app
App ID: ari:cloud:ecosystem::app/12345678-1234-1234-1234-123456789012
```
**➡️ Copie este App ID**

### Passo 2: Editar manifest.yml
**Antes:**
```yaml
app:
  id: ari:cloud:ecosystem::app/SUBSTITUIR-PELO-SEU-APP-ID
```

**Depois:**
```yaml
app:
  id: ari:cloud:ecosystem::app/12345678-1234-1234-1234-123456789012
```

### Passo 3: forge deploy
```
✔ Deploying your app
✔ Build successful
✔ Uploaded
✔ Deployed
```

### Passo 4: forge install
```
? Install app to: Jira
? Select site: yourcompany.atlassian.net
✔ Installed
```

---

## ✅ Verificação

### Como saber se funcionou?

1. **No terminal:**
   ```bash
   forge install --list
   ```
   Deve mostrar seu app instalado

2. **No Jira:**
   - Vá para um Projeto
   - Menu lateral esquerdo
   - Procure "Roadmap Forecaster"
   - Se aparecer = ✅ Funcionou!

---

## 🐛 Se algo der errado

### Erro: "App ID not valid"
```bash
# Verifique se editou o manifest.yml
cat manifest.yml | grep "app:"

# Deve mostrar seu App ID, não "SUBSTITUIR..."
```

### Erro: "forge command not found"
```bash
# Instale o Forge CLI novamente
npm install -g @forge/cli

# Verifique
forge --version
```

### Não vejo o app no Jira
1. ✅ Você está em um **Projeto**? (não em Settings/Admin)
2. ✅ Fez `forge install`?
3. ✅ Selecionou o site Jira correto?

**Tente reinstalar:**
```bash
forge uninstall
forge install
```

---

## 🎓 Primeiro Uso

### 1. Adicionar Squad
<img src="https://via.placeholder.com/600x400/667eea/FFFFFF?text=Click+Add+Squad" width="600"/>

**Exemplo:**
- Nome: `Backend Team`
- Throughput: `10`

### 2. Adicionar Epic
<img src="https://via.placeholder.com/600x400/764ba2/FFFFFF?text=Click+Add+Epic" width="600"/>

**Exemplo:**
- Nome: `User Authentication`
- Story Points: `100`
- Squad: `Backend Team`

### 3. Executar Simulação
<img src="https://via.placeholder.com/600x400/10b981/FFFFFF?text=Run+Simulation" width="600"/>

**Resultado:**
- P50: 10.2 weeks ← 50% de chance
- P85: 14.3 weeks ← 85% de chance
- P95: 17.1 weeks ← 95% de chance

---

## 🚀 Comandos Úteis

```bash
# Ver logs em tempo real
forge logs

# Desenvolvimento com hot-reload
forge tunnel

# Verificar erros no código
forge lint

# Ver apps instalados
forge install --list

# Desinstalar
forge uninstall

# Reinstalar
forge uninstall && forge install
```

---

## 💡 Dicas Pro

### Desenvolvimento Rápido
```bash
# Terminal 1: Tunnel
forge tunnel

# Terminal 2: Logs
forge logs --follow
```
Agora qualquer mudança no código é instantânea!

### Testar em Múltiplos Sites
```bash
forge install
# Escolha site 1

forge install
# Escolha site 2
```

### Backup de Dados
Os dados ficam no LocalStorage do navegador. Para fazer backup:
1. Abra DevTools (F12)
2. Console → digite:
   ```javascript
   localStorage.getItem('roadmap_data')
   ```
3. Copie o JSON

---

## 📞 Ajuda Rápida

| Problema | Solução |
|----------|---------|
| Erro no deploy | `forge deploy --verbose` |
| App não aparece | Vá para um **Projeto** |
| Mudanças não aplicam | `forge deploy` e recarregue |
| Erro de permissão | `forge login` novamente |

---

## ✨ Parabéns!

Você tem um app Jira funcional rodando! 🎉

**Próximo passo:** Adicione squads, épicos e rode sua primeira simulação!

---

*Guia criado para total iniciantes - do zero ao ar em 5 minutos!*
