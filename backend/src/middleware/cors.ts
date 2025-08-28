export const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://localhost:4000", 
    "http://localhost:5000",
    "https://spherosegapp.utia.cas.cz"
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
};