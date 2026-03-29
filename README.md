# Performance Evaluation System (PES)

A comprehensive web application for managing academic performance evaluations built with React, TypeScript, Tailwind CSS, and Express.js backend.

## Project Structure

This project is organized with a **monorepo** structure separating frontend and backend:

```
├── frontend/          # React + Vite frontend application
│   ├── src/          # React components, pages, and application logic
│   ├── package.json  # Frontend dependencies
│   └── ... (build configs)
├── backend/          # Express.js API server
│   ├── src/          # Server logic, routes, controllers
│   ├── package.json  # Backend dependencies
│   └── ... (config files)
├── guidelines/       # Project guidelines and standards
├── DESIGN_SYSTEM.md  # UI/UX design principles
└── ATTRIBUTIONS.md   # Attributions and acknowledgments
```

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Frontend Setup

```bash
# Navigate to frontend folder
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

The frontend will be available at `http://localhost:5173`

### Backend Setup

```bash
# Navigate to backend folder
cd backend

# Install dependencies
npm install

# Create .env file from example
cp .env.example .env

# Start development server
npm run dev
```

The backend API will be available at `http://localhost:3000`

## Frontend Technology Stack

- **React** 18.3.1 - UI framework
- **TypeScript** - Type safety
- **Vite** 6.3.5 - Build tool
- **Tailwind CSS** 4.1.12 - Utility-first CSS
- **Framer Motion** 12.38.0 - Animations
- **Radix UI** - Headless UI components
- **React Router v7** - Client-side routing
- **Recharts** - Data visualization
- **Lucide React** - Icon library

### Features

- ✨ Dark mode with auto/light/dark theme options
- 📊 Dashboard with analytics and statistics
- 📚 Course and enrollment management
- 👥 Student profiles and attendance tracking
- 🎯 Performance evaluation and results
- ⚙️ User settings and preferences
- 🤖 AI Assistant integration ready

## Backend Technology Stack

- **Express.js** 4.18.2 - REST API framework
- **PostgreSQL** - Database (via pg)
- **JWT** - Authentication and authorization
- **CORS** - Cross-origin resource sharing
- **Dotenv** - Environment configuration
- **Joi** - Data validation

### API Features (In Development)

- User authentication and authorization
- Course management endpoints
- Student enrollment APIs
- Performance evaluation endpoints
- Attendance tracking APIs

## Development

### Building for Production

#### Frontend

```bash
cd frontend
npm run build
```

Output will be in `frontend/dist/`

#### Backend

```bash
cd backend
npm start
```

### Project Guidelines

Please refer to:

- [Design System](./DESIGN_SYSTEM.md) - UI/UX standards
- [Guidelines](./guidelines/Guidelines.md) - Development practices

## Troubleshooting

### Frontend not starting?

- Ensure you're in the `frontend/` directory
- Delete `node_modules/` and run `npm install` again
- Check that port 5173 is not in use

### Backend not starting?

- Ensure you're in the `backend/` directory
- Copy `.env.example` to `.env`
- Check that port 3000 is not in use
- Verify PostgreSQL is running (if database connection is enabled)

## Learn More

- [Frontend README](./frontend/README.md)
- [Backend README](./backend/README.md)
- [Design System](./DESIGN_SYSTEM.md)

## License

See [ATTRIBUTIONS.md](./ATTRIBUTIONS.md) for license information.
