-- Crear la tabla blocked_dates
CREATE TABLE "blocked_dates" (
    "id" SERIAL PRIMARY KEY,
    "date" DATE NOT NULL UNIQUE,
    "reason" TEXT
);

-- Añadir un índice a la columna date para búsquedas rápidas
CREATE INDEX "idx_blocked_dates_date" ON "blocked_dates"("date");
