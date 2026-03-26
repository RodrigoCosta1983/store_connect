# Store&Connect - Sistema de Gestão para Lojas e Distribuidoras

[Read in English](#english-version)

![Flutter](https://img.shields.io/badge/Flutter-02569B?style=for-the-badge&logo=flutter&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)
![Dart](https://img.shields.io/badge/Dart-0175C2?style=for-the-badge&logo=dart&logoColor=white)

**Store&Connect** é um sistema de Ponto de Venda (PDV) e gestão completo, desenvolvido em Flutter, projetado para otimizar as operações de pequenas e médias lojas e distribuidoras. A aplicação é focada em uma arquitetura multi-loja, permitindo que um único sistema gerencie múltiplos estabelecimentos de forma segura e centralizada, com dados armazenados e sincronizados em tempo real através do Firebase.

## ✨ Funcionalidades Principais

O aplicativo foi construído com uma base sólida, focando em funcionalidades essenciais para a gestão de um negócio:

### Gestão de Vendas
- **Tela de Venda Rápida (PDV):** Interface com grade de produtos responsiva que se adapta a diferentes tamanhos de tela (celulares, tablets).
- **Controle de Estoque em Tempo Real:** A interface visualiza o status do estoque de cada produto (normal, baixo, esgotado) e impede a venda de itens sem estoque.
- **Carrinho de Compras:** Sistema completo para adicionar produtos, com a flexibilidade de vender para um cliente cadastrado ou para o "Consumidor Final".
- **Múltiplos Métodos de Pagamento:** Suporte para vendas em Dinheiro, Cartão, PIX e a Crédito.
- **Vendas "A Crédito":** Sistema para registrar vendas a prazo, exigindo a seleção de um cliente cadastrado.

### Gestão de Estoque
- **Cadastro e Edição de Produtos:** Formulário completo para gerenciar produtos, incluindo nome, preço, quantidade em estoque e **estoque mínimo** para alertas.
- **Upload de Imagens:** Suporte para upload de imagens de produtos tanto do celular quanto da web.
- **Baixa Automática de Estoque:** Após cada venda confirmada, a quantidade do produto é subtraída do estoque de forma atômica e segura, usando Batched Writes do Firebase.

### Gestão de Clientes (CRM)
- **Cadastro e Edição de Clientes:** Tela dedicada para gerenciar a base de clientes da loja.
- **Busca Inteligente:** Interface de busca dinâmica para encontrar clientes rapidamente.
- **Reutilização de Componentes:** A tela de gerenciamento também funciona como um seletor de clientes para outras partes do app (ex: vendas A Crédito).

### Dashboard e Relatórios
- **Dashboard em Tempo Real:** Painel principal com os KPIs (Indicadores Chave de Performance) mais importantes:
    - Total de Vendas do Dia
    - Número de Vendas
    - Ticket Médio
    - Total a Receber (A Crédito)
    - Contagem de Produtos com Estoque Baixo
- **Hub de Relatórios:** Uma central organizada para análises mais profundas.
    - **Relatório de Vendas por Período:** Permite filtrar vendas por um intervalo de datas customizável.
    - **Relatório de Estoque Baixo:** Lista todos os produtos que precisam de reposição.
    - **Relatório de Contas a Receber:** Mostra a dívida total por cliente e permite detalhar e quitar as vendas pendentes.
    - **Análise de Curva ABC de Produtos:** Classifica os produtos em A, B e C, mostrando quais são os mais importantes para o faturamento da loja.

### Configurações e Segurança
- **Tela de Configurações:**
    - Permite habilitar/desabilitar a funcionalidade de vendas "A Crédito".
    - Permite configurar o limite numérico para o alerta de estoque baixo.
- **Tela de Perfil do Usuário:**
    - Permite que o usuário edite seus dados de perfil (nome, documento, telefone).
    - Funcionalidade segura para **alterar senha e e-mail** diretamente no app, com reautenticação para garantir a segurança.
- **Autenticação Segura:** Fluxo completo de login e logout gerenciado pelo Firebase Auth e um `AuthGate` para proteger as rotas.

### 🚀 Onboarding e Segurança
- **Fluxo de Cadastro Completo:** Permite que novos usuários se cadastrem com E-mail/Senha ou Login com Google.

- **Criação de Loja:** Onboarding guiado para que o novo usuário crie sua própria loja no sistema.

- **Login Seguro e Moderno:**

- Múltiplas opções de login (E-mail/Senha, Google).

- Opção de "Lembrar-me" para salvar credenciais de forma segura.

- Login com Biometria (digital ou facial) para acesso rápido e seguro, com opção de ativação nas configurações.

- Gerenciamento de Perfil: O usuário pode editar seus dados e alterar sua senha com segurança.

### Motor de Recibos e Impressão
- **Geração Dinâmica de PDFs:** Criação de recibos profissionais *White-Label* (com a identidade visual da loja geradora).

- **Múltiplos Formatos:** Exportação otimizada em tamanho **A4** (ideal para compartilhamento via WhatsApp e e-mail) e formato contínuo para **Bobinas de 58mm** (mini impressoras térmicas Bluetooth).

- **Tipografia e Emojis:** Implementação de `fontFallback` para garantir a renderização perfeita de emojis nos nomes de produtos e observações dos clientes.

- **Rastreabilidade:** Inclusão automática do ID da transação no Firestore diretamente no cabeçalho do recibo.

### 💰 Monetização (SaaS) e Pagamentos
- **Integração com Asaas:** Sistema completo de cobrança e gestão de assinaturas recorrentes integrado à API do Asaas.

- **Webhooks via Cloud Functions:** Lógica de backend no Firebase para receber webhooks do Asaas, validando pagamentos de forma assíncrona e atualizando o status da assinatura da loja no Firestore em tempo real.

- **Integração com Google Play Billing:** Sistema complementar para gestão de assinaturas via lojas de aplicativos.

- **Validação de Acesso (AuthGate):** O sistema verifica o status da assinatura e libera ou bloqueia o acesso ao app instantaneamente, garantindo a segurança do modelo SaaS.

## 📸 Telas do Aplicativo

*(Instrução: Para adicionar suas imagens aqui, faça o upload delas para a pasta do seu projeto no GitHub e substitua as `URL_DA_SUA_IMAGEM_AQUI` pelo link da imagem)*

| Tela de Venda | Dashboard | Perfil e Segurança |
| :---: | :---: | :---: |
| <img src="https://github.com/RodrigoCosta1983/store_connect/blob/main/assets/images/README/Tela%20de%20Venda.png"  width="200" height="400"> | <img src="https://github.com/RodrigoCosta1983/store_connect/blob/main/assets/images/README/Dashboard.png"  width="200" height="400"> | <img src="https://github.com/RodrigoCosta1983/store_connect/blob/main/assets/images/README/Perfil%20e%20Seguran%C3%A7a.png"  width="200" height="400"> |

| Análise ABC | Contas a Receber | Gerenciar Produtos |
| :---: | :---: | :---: |
| <img src="https://github.com/RodrigoCosta1983/store_connect/blob/main/assets/images/README/An%C3%A1lise%20ABC.png"  width="200" height="400">| <img src="https://github.com/RodrigoCosta1983/store_connect/blob/main/assets/images/README/Contas%20a%20Receber.png"  width="200" height="400">  | <img src="https://github.com/RodrigoCosta1983/store_connect/blob/main/assets/images/README/Gerenciar%20Produtos.png"  width="200" height="400">  |


## 🚀 Tecnologias Utilizadas

- **Framework:** [Flutter](https://flutter.dev/)
- **Linguagem:** [Dart](https://dart.dev/)
- **Backend & Database:** [Firebase](https://firebase.google.com/)
    - **Cloud Firestore:** Banco de dados NoSQL em tempo real.
    - **Firebase Authentication:** Sistema de autenticação de usuários.
    - **Firebase Storage:** Armazenamento de imagens de produtos.
- **Gerenciamento de Estado:** [Provider](https://pub.dev/packages/provider)
- **Pacotes Principais:**
    - `cloud_firestore`
    - `firebase_auth`
    - `firebase_storage`
    - `image_picker`
    - `shared_preferences`
    - `intl`
    - `url_launcher`

## 🔮 Próximos Passos (Roadmap)

Com a arquitetura SaaS e o gateway de pagamento (Asaas) já estabelecidos, os próximos objetivos focam em expansão de plataforma:

- **Versão Web (Dashboard Administrativo):** Adaptar a aplicação Flutter para funcionar perfeitamente em navegadores, permitindo que os lojistas gerenciem seus estoques e vejam relatórios diretamente do computador, com um layout responsivo focado em desktop.

- **Gestão de Múltiplos Usuários por Loja:** Criar níveis de acesso (Admin, Vendedor, Caixa) para que o dono da loja possa convidar funcionários para operar o PDV sem dar acesso às configurações financeiras e de assinatura.


## 🏁 Como Executar o Projeto

1.  **Pré-requisitos:**
    - Ter o [Flutter SDK](https://flutter.dev/docs/get-started/install) instalado.
    - Ter um editor de código como VS Code ou Android Studio.

2.  **Configuração do Firebase:**
    - Crie um novo projeto no [Console do Firebase](https://console.firebase.google.com/).
    - Habilite os serviços de **Authentication** (com o provedor E-mail/Senha), **Cloud Firestore**, e **Firebase Storage**.
    - Configure seu aplicativo (Android/iOS/Web) no projeto Firebase e adicione os arquivos de configuração (`google-services.json` para Android, etc.) no seu projeto Flutter.
    - O arquivo `lib/firebase_options.dart` deve ser gerado automaticamente via FlutterFire CLI.

3.  **Execução:**
    ```bash
    # Clone o repositório
    git clone [https://github.com/SEU_USUARIO/store_connect.git](https://github.com/SEU_USUARIO/store_connect.git)
    
    # Entre na pasta do projeto
    cd store_connect
    
    # Instale as dependências
    flutter pub get
    
    # Execute o aplicativo
    flutter run
    ```
---

👨‍💻 Autor
RodrigoCostaDEV

GitHub: @RodrigoCosta1983

LinkedIn:  [linkedin RodrigoCostaDEV](https://www.linkedin.com/in/dev-rodrigo-costa/)

Website: https://www.storeconnect.com.br

## <a name="english-version"></a> English Version

[Leia em Português](#store&connect---sistema-de-gestão-para-lojas-e-distribuidoras)

![Flutter](https://img.shields.io/badge/Flutter-02569B?style=for-the-badge&logo=flutter&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)
![Dart](https://img.shields.io/badge/Dart-0175C2?style=for-the-badge&logo=dart&logoColor=white)

**Store&Connect** is a comprehensive Point of Sale (POS) and management system, developed in Flutter, designed to optimize the operations of small and medium-sized stores and distributors. The application is focused on a multi-store architecture, allowing a single system to manage multiple establishments securely and centrally, with data stored and synced in real-time via Firebase.

## ✨ Key Features

The application was built on a solid foundation, focusing on essential features for business management:

### Sales Management
- **Quick Sale Screen (POS):** A responsive product grid interface that adapts to different screen sizes (phones, tablets).
- **Real-time Inventory Control:** The interface displays the stock status of each product (normal, low, out of stock) and prevents the sale of out-of-stock items.
- **Shopping Cart:** A complete system for adding products, with the flexibility to sell to a registered customer or to a "Final Consumer".
- **Multiple Payment Methods:** Support for sales via Cash, Card, PIX, and credit.
- **(Credit) Sales:** A system to record on-credit sales, requiring the selection of a registered customer.

### Inventory Management
- **Product Creation and Editing:** A complete form to manage products, including name, price, quantity in stock, and a **minimum stock level** for alerts.
- **Image Uploads:** Support for uploading product images from both mobile and web.
- **Automatic Stock Decrement:** After each confirmed sale, the product quantity is atomically and safely subtracted from the inventory using Firebase Batched Writes.

### Customer Management (CRM)
- **Customer Creation and Editing:** A dedicated screen to manage the store's customer base.
- **Smart Search:** A dynamic search interface to find customers quickly.
- **Component Reuse:** The management screen also functions as a customer selector for other parts of the app (e.g., credit sales).

### Dashboard & Reports
- **Real-time Dashboard:** A main dashboard with the most important KPIs (Key Performance Indicators):
    - Total Sales for the Day
    - Number of Sales
    - Average Ticket
    - Total Accounts Receivable (Credit)
    - Low Stock Product Count
- **Reports Hub:** An organized center for deeper analysis.
    - **Sales by Period Report:** Allows filtering sales by a customizable date range.
    - **Low Stock Report:** Lists all products that need restocking.
    - **Accounts Receivable Report:** Shows the total debt per customer and allows for viewing and settling pending sales.
    - **ABC Product Analysis:** Classifies products into A, B, and C, showing which are most critical to the store's revenue.

### Settings & Security
- **Settings Screen:**
    - Allows you to enable or disable the credit sales feature.
    - Allows configuring the numerical threshold for the low stock alert.
- **User Profile Screen:**
    - Allows the user to edit their profile data (name, document, phone).
    - Secure functionality to **change password and email** directly within the app, with re-authentication to ensure security.
- **Secure Authentication:** A complete login and logout flow managed by Firebase Auth and an `AuthGate` to protect routes.

### 🚀 Onboarding and Security
- **Complete Registration Flow:** Allows new users to register with Email/Password or Google Login.

- **Store Creation:** Guided onboarding for new users to create their own store in the system.

- **Secure and Modern Login:**

- Multiple login options (Email/Password, Google).

- "Remember Me" option to securely save credentials.

- Biometric login (fingerprint or facial) for quick and secure access, with an option to enable it in the settings.

- Profile Management: Users can securely edit their data and change their password.

### Receipt Engine and Printing
- **Dynamic PDF Generation:** Creation of professional White-Label receipts (featuring the generating store's visual identity).
 
- **Multiple Formats:** Optimized export in **A4** size (ideal for sharing via WhatsApp and email) and continuous format for **58mm Rolls** (Bluetooth mini thermal printers).
 
- **Typography and Emojis:** Implementation of `fontFallback` to ensure perfect rendering of emojis in product names and customer notes.

- **Traceability:** Automatic inclusion of the Firestore transaction ID directly in the receipt header.

### 💰 Monetization (SaaS) and Payments
- **Asaas Integration:** Complete billing and recurring subscription management system integrated with the Asaas API.

## 🔮 Next Steps (Roadmap)

With the SaaS architecture and payment gateway (Asaas) already established, the next objectives focus on platform expansion:

- **Web Version (Admin Dashboard):** Adapt the Flutter application to work seamlessly in browsers, allowing store owners to manage their inventory and view reports directly from their computers, with a responsive desktop-focused layout.

- **Multi-User Management per Store:** Create access levels (Admin, Salesperson, Cashier) so the store owner can invite employees to operate the POS without granting access to financial and subscription settings.

## 🏁 Getting Started

1.  **Prerequisites:**
    - Have the [Flutter SDK](https://flutter.dev/docs/get-started/install) installed.
    - Have a code editor like VS Code or Android Studio.

2.  **Firebase Setup:**
    - Create a new project in the [Firebase Console](https://console.firebase.google.com/).
    - Enable the **Authentication** (with the Email/Password provider), **Cloud Firestore**, and **Firebase Storage** services.
    - Configure your application (Android/iOS/Web) in the Firebase project and add the configuration files (`google-services.json` for Android, etc.) to your Flutter project.
    - The `lib/firebase_options.dart` file should be generated automatically via the FlutterFire CLI.

3.  **Running the Application:**
    ```bash
    # Clone the repository
    git clone [https://github.com/YOUR_USERNAME/store_connect.git](https://github.com/YOUR_USERNAME/store_connect.git)
    
    # Enter the project folder
    cd store_connect
    
    # Install dependencies
    flutter pub get
    
    # Run the application
    flutter run
    ```

👨‍💻 Developer
RodrigoCostaDEV

GitHub: @RodrigoCosta1983

LinkedIn:  [linkedin RodrigoCostaDEV](https://www.linkedin.com/in/dev-rodrigo-costa/)

Website: https://www.storeconnect.com.br/