# Anki Audio Card Creator Desktop

Aplicativo Desktop desenvolvido com **Electron**, **Angular 19**, **TypeScript**, **Tailwind CSS** e **Yarn** para criação ágil de cards de estudo para o **Anki** com suporte a áudio.

---

## 🚀 Como Executar em Desenvolvimento

Para rodar a aplicação localmente com recarregamento em tempo real:

```bash
run.bat
```
ou:
```bash
yarn electron:dev
```

Isso inicializa o servidor de desenvolvimento do Angular na porta `4200`, compila o processo principal do Electron e abre a janela do aplicativo automaticamente.

---

## 📦 Como Compilar para Executável (.exe)

Para gerar o instalador (NSIS) e a versão portátil (Portable):

```bash
compile.bat
```
ou:
```bash
yarn build:electron
```

Os executáveis compilados serão salvos na pasta **`exec/`**:
- `exec/AnkiCardCreator-Setup-1.0.0.exe` (Instalador padrão para Windows x64)
- `exec/AnkiCardCreator-Portable-1.0.0.exe` (Executável portátil sem necessidade de instalação)

---

## ✨ Funcionalidades Principais

- **Tela Única Otimizada para Produtividade**:
  - Campo **Frente** (Expressão / Frase) com foco automático.
  - Campo **Verso** (Tradução / Significado / Resposta).
  - Seletor de **Baralho (Deck)** e **Tags** persistentes para inserções rápidas em sequência.
- **Áudio Integrado**:
  - **Gravação de Voz Direta**: Grave sua pronúncia com microfone (com cronômetro e indicador visual).
  - **Upload e Drag & Drop**: Arraste arquivos `.mp3`, `.wav`, `.m4a` ou utilize o explorador de arquivos.
  - **Player Integrado**: Ouça o áudio imediatamente antes de salvar.
- **Métodos de Salvamento Duplo**:
  1. **AnkiConnect (API local)**: Insere o card instantaneamente direto no Anki Desktop (porta `8765`), armazenando o áudio via `storeMediaFile`.
  2. **Arquivo de Importação (.txt)**: Exporta em formato TSV compatível com Anki (`#separator:tab`, `#html:true`, `#tags column:4`) e copia o arquivo para a pasta `collection.media` do Anki.
- **Atalhos de Teclado**:
  - `Ctrl + Enter`: Salva o card e prepara o formulário para o próximo.
  - `Ctrl + Espaço`: Reproduz / pausa o preview do áudio.
  - `Esc`: Fecha janelas de histórico e configurações.
- **Painel de Histórico da Sessão**: Visualize todos os cards criados durante a sessão atual.

---

## 🛠️ Estrutura do Projeto

```text
├── electron/               # Backend do Electron (TypeScript)
│   ├── main.ts             # Ciclo de vida e criação de janela
│   ├── preload.ts          # Comunicação IPC segura (contextBridge)
│   ├── services/           # Serviços AnkiConnect, Arquivos e Áudio
│   └── types/              # Interfaces tipadas de Card e Configurações
├── src/                    # Frontend Angular 19 (Tailwind CSS)
│   ├── app/
│   │   ├── core/services/  # ElectronService tipado
│   │   ├── app.component.ts# Lógica da tela única
│   │   └── app.component.html
│   ├── index.html
│   └── styles.css
├── dist/                   # Saída da compilação do Angular
├── dist-electron/          # Saída da compilação do Electron
├── exec/                   # Executáveis Windows (.exe) gerados
├── package.json            # Scripts Yarn e dependências
├── electron-builder.json   # Configuração de empacotamento NSIS e Portable
├── run.bat                 # Script de desenvolvimento
└── compile.bat             # Script de build de release
```
