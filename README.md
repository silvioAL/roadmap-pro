# 🎯 Roadmap Forecaster Pro - Jira Forge App

**Monte Carlo forecasting for multi-squad agile teams**

Um plugin Jira totalmente funcional para previsão de roadmap usando simulação Monte Carlo com 10.000 iterações.

---

## 🚀 Instalação Rápida (15 minutos)

### Pré-requisitos

1. **Node.js 18+** instalado
   ```bash
   node --version  # Deve mostrar v18.x ou superior
   ```

2. **Conta Atlassian** (gratuita)
   - Crie em: https://www.atlassian.com/try/cloud/signup

3. **Jira Cloud site** (gratuito)
   - Crie em: https://www.atlassian.com/software/jira/free

---

## 📦 Passo 1: Instalar Forge CLI

```bash
npm install -g @forge/cli
```

Verifique a instalação:
```bash
forge --version
```

---

## 🔑 Passo 2: Login no Forge

```bash
forge login
```

Isso vai abrir seu navegador para autenticar. Faça login com sua conta Atlassian.

---

## 📁 Passo 3: Extrair o Projeto

```bash
# Extrair o arquivo
tar -xzf roadmap-pro.tar.gz

# Entrar na pasta
cd roadmap-pro

# Instalar dependências
npm install
```

---

## 🎯 Passo 4: Registrar o App

```bash
forge register
```

Quando solicitado:
- **App name:** `roadmap-forecaster-pro` (ou qualquer nome)
- **Category:** Escolha `Productivity` ou `Development Tools`

O Forge vai gerar um **App ID** (exemplo: `ari:cloud:ecosystem::app/12345678-1234-1234-1234-123456789012`)

---

## ⚙️ Passo 5: Atualizar manifest.yml

Abra o arquivo `manifest.yml` e substitua:

```yaml
app:
  id: ari:cloud:ecosystem::app/SUBSTITUIR-PELO-SEU-APP-ID
```

Pelo App ID que você recebeu no passo anterior.

---

## 🚀 Passo 6: Deploy

```bash
forge deploy
```

Este comando vai:
- ✅ Compilar o código
- ✅ Fazer upload para Atlassian
- ✅ Criar uma versão do seu app

---

## 📥 Passo 7: Instalar no Jira

```bash
forge install
```

Quando solicitado:
1. **Escolha o produto:** Selecione `Jira`
2. **Escolha o site:** Selecione seu site Jira (exemplo: `yourcompany.atlassian.net`)

O app será instalado no seu Jira!

---

## ✅ Passo 8: Acessar o App

1. Abra seu Jira: `https://seu-site.atlassian.net`
2. Vá para qualquer **Projeto**
3. No menu lateral esquerdo, procure por **"Roadmap Forecaster"**
4. Clique e o app vai abrir! 🎉

---

## 🎓 Como Usar

### 1. Adicionar Squads

1. Clique em **"+ Add Squad"**
2. Digite:
   - **Squad Name:** `Backend Team`
   - **Throughput:** `10` (story points por semana)
3. Clique em **"Add"**

Repita para adicionar mais squads.

### 2. Adicionar Épicos

1. Clique em **"+ Add Epic"**
2. Digite:
   - **Epic Name:** `User Authentication`
   - **Story Points:** `100`
   - **Squad:** Selecione uma squad
3. Clique em **"Add"**

Adicione vários épicos.

### 3. Executar Simulação

1. Clique em **"🚀 Run Simulation (10,000 iterations)"**
2. Aguarde ~2 segundos
3. Veja os resultados:
   - **P50:** Data mediana (50% de chance)
   - **P85:** Data confiável (85% de chance)
   - **P95:** Data conservadora (95% de chance)

---

## 🔧 Desenvolvimento (Opcional)

Para desenvolver localmente com hot-reload:

```bash
forge tunnel
```

Isso cria um túnel entre seu computador e o Jira. Qualquer mudança no código será refletida imediatamente.

---

## 📊 Features

✅ **Gerenciamento de Squads**
- Adicionar/remover squads
- Definir throughput (velocity)
- Cores automáticas

✅ **Gerenciamento de Épicos**
- Adicionar/remover épicos
- Alocar para squads
- Story points

✅ **Simulação Monte Carlo**
- 10.000 iterações
- Distribuição triangular
- Percentis P50, P85, P95

✅ **Persistência de Dados**
- LocalStorage do navegador
- Dados salvos automaticamente

✅ **UI Moderna**
- Design gradiente
- Animações suaves
- Responsivo

---

## 🐛 Problemas Comuns

### "Command not found: forge"
**Solução:** Instale o Forge CLI
```bash
npm install -g @forge/cli
```

### "App ID not valid"
**Solução:** Verifique se você atualizou o `manifest.yml` com o App ID correto do `forge register`

### "Não consigo ver o app no Jira"
**Solução:**
1. Verifique se fez `forge install`
2. Vá para um **Projeto** no Jira (não funciona em telas de administração)
3. Procure no menu lateral esquerdo

### "Erro ao fazer deploy"
**Solução:**
```bash
forge lint  # Verifica erros no código
forge deploy --verbose  # Deploy com logs detalhados
```

---

## 🔄 Atualizações

Para fazer mudanças no código:

1. Edite os arquivos
2. Execute:
   ```bash
   forge deploy
   ```
3. Recarregue a página do Jira

---

## 📚 Recursos

- [Forge Documentation](https://developer.atlassian.com/platform/forge/)
- [Forge CLI Reference](https://developer.atlassian.com/platform/forge/cli-reference/)
- [Atlassian Community](https://community.atlassian.com/)

---

## 🎯 Próximos Passos

Depois de testar o app básico, você pode:

1. **Adicionar mais features:**
   - Jira integration
   - Gantt chart
   - Export/import
   - Advanced metrics

2. **Publicar no Marketplace:**
   - Seguir [guia de publicação](https://developer.atlassian.com/platform/marketplace/publishing-apps/)
   - Adicionar pricing
   - Marketing

3. **Customizar:**
   - Mudar cores/design
   - Adicionar seu logo
   - Personalizar cálculos

---

## 💡 Dicas

- **Desenvolvimento:** Use `forge tunnel` para testar mudanças instantaneamente
- **Logs:** Use `forge logs` para ver erros em tempo real
- **Reinstalar:** Use `forge uninstall` e depois `forge install` para reinstalar

---

## 📄 Licença

MIT License - use como quiser!

---

## 🆘 Suporte

Problemas? Abra uma issue ou entre em contato!

---

**Feito com ❤️ para times ágeis**

Transforme seu planejamento de roadmap hoje! 🚀
