# TODO — PixGen AI

- [x] **Interface de geração e resultado**
  - O usuário informa as informações da imagem em um formulário de prompt.
  - O usuário escolhe proporção e qualidade.
  - Cada imagem gerada desconta exatamente 1 crédito.
  - Após gerar, a imagem fica visível na tela e pode ser baixada.
  - A interface mostra estados de carregamento, erro e sucesso.

- [x] **Saldo e histórico**
  - O usuário vê quantos créditos possui no cabeçalho e na seção de créditos.
  - O histórico mostra imagens geradas, prompts, data e formato.
  - O usuário pode abrir e baixar imagens já geradas.
  - Os registros são persistidos no PostgreSQL conectado ao deploy.

- [x] **Compra de créditos com Mercado Pago**
  - Cada crédito custa R$1,00.
  - O usuário escolhe quantidade e o site cria uma preferência de pagamento.
  - O site abre o Checkout Pro do Mercado Pago.
  - O servidor consulta o pagamento com o token privado e só credita quando o status é aprovado.
  - O webhook e a verificação de retorno são idempotentes.
  - A aplicação oferece URL de webhook no README.

- [x] **Entrega Vercel em pasta única**
  - Todos os arquivos da aplicação ficam diretamente na pasta raiz, sem subpastas criadas pelo projeto.
  - As únicas chaves manuais documentadas são `OPENAI_API_KEY` e `MP_ACCESS_TOKEN`.
  - A conexão de banco é obtida por integração PostgreSQL do Vercel e não é exibida no frontend.
  - O deploy inclui instruções de variáveis, banco e webhook.
