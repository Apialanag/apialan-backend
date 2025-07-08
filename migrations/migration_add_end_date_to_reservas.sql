-- Añadir la columna end_date a la tabla reservas
ALTER TABLE "reservas"
ADD COLUMN "end_date" DATE;

-- Actualizar las reservas existentes para que end_date sea igual a fecha_reserva
UPDATE "reservas"
SET "end_date" = "fecha_reserva"
WHERE "end_date" IS NULL;

-- Opcionalmente, si quieres asegurarte de que end_date no pueda ser NULL para nuevas reservas (después de la migración)
-- ALTER TABLE "reservas"
-- ALTER COLUMN "end_date" SET NOT NULL;
-- Sin embargo, vamos a mantenerlo nullable por ahora según la discusión inicial (end_date puede ser NULL o igual a start_date).
-- Para simplificar, la lógica de la aplicación se asegurará de que siempre tenga un valor (igual a fecha_reserva para días únicos).
