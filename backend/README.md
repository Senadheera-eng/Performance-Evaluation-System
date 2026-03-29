# Performance Evaluation System - Backend

Node.js + Express backend API for the Performance Evaluation System.

## Technology Stack

- **Node.js** - Runtime
- **Express.js** - Web framework
- **PostgreSQL** - Database
- **JWT** - Authentication
- **Joi** - Data validation
- **CORS** - Cross-origin support

## Project Structure

```
backend/
├── src/
│   ├── routes/          # API route definitions
│   ├── controllers/      # Business logic
│   ├── models/          # Database models
│   ├── middleware/      # Express middleware
│   └── server.js        # Entry point
├── .env.example         # Environment variables template
├── package.json
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 16+
- PostgreSQL 12+
- npm or yarn

### Installation

```bash
cd backend
npm install
```

### Configuration

1. Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

2. Update the `.env` file with your configuration:

```
PORT=3000
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=pes_database
JWT_SECRET=your_secret_key
```

### Development

```bash
npm run dev
```

The API will be available at `http://localhost:3000/api`

### Production

```bash
npm start
```

## API Endpoints

### Health Check

- `GET /api/health` - Server status

### TODO: Add endpoints as you build

```
Authentication
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- POST /api/auth/refresh

Courses
- GET /api/courses
- GET /api/courses/:id
- POST /api/courses
- PUT /api/courses/:id
- DELETE /api/courses/:id

Attendance
- GET /api/attendance/student/:id
- POST /api/attendance
- PUT /api/attendance/:id

Results
- GET /api/results/student/:id
- POST /api/results
- PUT /api/results/:id

AI Assistant
- POST /api/ai/chat
- POST /api/ai/predict-grade
```

## Database Setup

### Create Database

```sql
CREATE DATABASE pes_database;
```

### Run Migrations

```bash
npm run migrate
```

## Authentication

The API uses JWT tokens for authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your_token>
```

## Error Handling

All errors return a standardized JSON response:

```json
{
  "error": {
    "message": "Error description",
    "status": 400
  }
}
```

## Testing

```bash
npm test
```

## Contributing

1. Create a feature branch
2. Make your changes
3. Write tests
4. Submit a pull request

## License

All rights reserved 2026
