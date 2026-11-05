# PixGen AI — plano de implementação

## Escopo

O PixGen AI é um estúdio web em português brasileiro para gerar imagens por IA. O usuário escreve uma descrição, escolhe formato e qualidade, e usa 1 crédito para gerar 1 imagem. Cada crédito custa R$1,00. O produto também oferece compra de créditos via Mercado Pago, conferência de pagamento no servidor, visualização, download, saldo e histórico.

A implementação é uma aplicação Node.js compatível com Vercel, com todos os arquivos diretamente na raiz do projeto. As duas credenciais manuais são `OPENAI_API_KEY` e `MP_ACCESS_TOKEN`. A persistência de créditos, compras e imagens usa a integração PostgreSQL do Vercel, que injeta uma variável de conexão automaticamente.

## Estrutura da pasta raiz

- `server.mjs`: servidor local e função Vercel. Serve a interface, gera imagens, cria preferências do Mercado Pago, verifica pagamentos, processa webhook idempotente e expõe o saldo/histórico.
- `index.html`, `styles.css`, `app.js`: interface do estúdio, créditos, checkout, visualização e histórico.
- `schema.sql`: esquema PostgreSQL para carteiras, compras e gerações.
- `vercel.json`: configuração de função única e arquivos estáticos incluídos no deploy.
- `.env.example`: nomes das duas variáveis manuais e referência à integração de banco.
- `README.md`: instruções de instalação, Vercel e webhook.

## Design

### Estilos considerados

- Neo-brutalismo editorial — 0,06: blocos fortes, bordas expressivas e alto contraste.
- Laboratório noturno — 0,07: interface escura, brilho limão e coral, focada em criação.
- Galeria minimalista — 0,05: muito espaço em branco, imagens como protagonistas.

### Direção escolhida: laboratório noturno

**Design Movement:** interface de ferramenta criativa com referências de painéis de laboratório, visualização de dados e editoras digitais independentes.

**Core Principles:** o prompt é o centro da experiência; o saldo permanece visível; o resultado aparece sem navegação extra; cada ação importante tem feedback imediato.

**Color Philosophy:** fundo azul-marinho quase preto para reduzir ruído e destacar a imagem. Limão elétrico representa ação e crédito disponível. Coral quente marca criação, pagamento e estados de atenção. Cinzas azulados sustentam hierarquia sem parecer uma tela administrativa genérica.

**Layout Paradigm:** navegação lateral curta e um palco de criação assimétrico. O formulário ocupa a coluna principal e o resultado ocupa um painel de destaque. Histórico e créditos mudam de vista sem criar páginas profundas.

**Signature Elements:** marca gráfica formada por um quadrado arredondado com um brilho diagonal; etiquetas de estado em cápsula; linhas finas de grade e pequenos marcadores de coordenada ao redor do palco de imagem.

**Interaction Philosophy:** todas as ações exibem estado de carregamento ou confirmação. O botão de geração informa o custo de 1 crédito. Compra e geração nunca alteram o saldo apenas no cliente: o servidor é a fonte de verdade.

**Animation:** transições curtas de 180–260ms; entrada do resultado com fade e deslocamento vertical; brilho muito sutil em botões ativos; nenhum efeito que prejudique leitura ou download.

**Typography System:** `Inter` ou fonte sans-serif do sistema para textos e controles; títulos com peso 800, espaçamento levemente negativo; números de crédito em peso 800 e alinhamento tabular.

**Brand Essence:** um estúdio direto para transformar ideias em imagens, com preço claro e resultado sob controle. Personalidade: preciso, criativo, transparente.

**Brand Voice:** headlines objetivas e confiantes; CTAs com o custo explícito. Exemplos: “Dê forma à ideia.” e “Gerar imagem · 1 crédito”.

**Wordmark & Logo:** “PixGen” em caixa baixa com o “x” tratado como um feixe diagonal, acompanhado de um quadrado arredondado com dois pontos de brilho.

**Signature Brand Color:** `#D5F65B`, um limão elétrico que torna saldo, ações e foco reconhecíveis.

## Backend e segurança

O servidor assina uma carteira anônima em cookie HttpOnly. O cliente não escolhe o saldo. Uma geração reserva o crédito no servidor antes de chamar a API e devolve o crédito se a chamada falhar. Pagamentos são gravados com referência externa e processados de forma idempotente; o webhook e a página de retorno consultam a API do Mercado Pago e só creditam pagamentos aprovados.

Em produção, o PostgreSQL é obrigatório para evitar perda ou duplicação de créditos entre funções serverless. A chave da IA e o token do Mercado Pago nunca são enviados ao navegador.
