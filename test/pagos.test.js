// test/pagos.test.js
const request = require('supertest');
const app = require('../index'); // Importar la app de Express

// Mockear los servicios externos antes de que se importen en las rutas
const { preference } = require('../services/mercadopago.service.js');
const pool = require('../db.js');
const { enviarEmailReservaConfirmada } = require('../services/email.service.js');

jest.mock('../services/mercadopago.service.js', () => ({
  preference: {
    create: jest.fn(),
  },
  payment: {
    get: jest.fn(),
    create: jest.fn(), // Añadir mock para el método create
  },
}));

jest.mock('../db.js', () => ({
  connect: jest.fn(),
  query: jest.fn(),
}));

jest.mock('../services/email.service.js', () => ({
  enviarEmailReservaConfirmada: jest.fn(),
}));


describe('Rutas de Pagos - /pagos', () => {

  // Limpiar mocks después de cada prueba
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /crear-preferencia', () => {
    it('debería retornar 201 y el init_point cuando la solicitud es válida', async () => {
      // Datos de entrada simulados
      const mockRequestBody = {
        reservaId: 'res-123',
        titulo: 'Reserva de Oficina',
        precio: 15000,
      };

      // Respuesta simulada del servicio de Mercado Pago
      const mockMPResponse = {
        id: 'pref-456',
        init_point: 'https://mercadopago.com/checkout/v1/redirect?pref_id=pref-456',
      };

      // Configurar el mock de preference.create para que devuelva la respuesta simulada
      const { preference } = require('../services/mercadopago.service.js');
      preference.create.mockResolvedValue(mockMPResponse);

      // Realizar la solicitud al endpoint
      const response = await request(app)
        .post('/pagos/crear-preferencia')
        .send(mockRequestBody);

      // --- Aserciones ---
      // 1. Verificar el código de estado
      expect(response.status).toBe(201);

      // 2. Verificar el cuerpo de la respuesta
      expect(response.body).toEqual({
        id: mockMPResponse.id,
        init_point: mockMPResponse.init_point,
      });

      // 3. Verificar que el mock de Mercado Pago fue llamado con los datos correctos
      expect(preference.create).toHaveBeenCalledTimes(1);
      expect(preference.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            items: [
              {
                id: mockRequestBody.reservaId,
                title: mockRequestBody.titulo,
                quantity: 1,
                unit_price: mockRequestBody.precio,
                currency_id: 'CLP',
              },
            ],
            back_urls: expect.any(Object),
            notification_url: expect.any(String),
          }),
        })
      );
    });

    it('debería retornar 400 cuando faltan datos en la solicitud', async () => {
      // Realizar la solicitud con un cuerpo incompleto
      const response = await request(app)
        .post('/pagos/crear-preferencia')
        .send({ titulo: 'Falta el precio y el ID' });

      // Verificar el código de estado y el mensaje de error
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Faltan detalles de la reserva (reservaId, titulo, precio).',
      });
    });
  });

  describe('POST /webhook', () => {
    const mockPaymentId = '12345';
    const mockReservaId = 'res-abc-789';
    const { payment } = require('../services/mercadopago.service.js');
    const pool = require('../db.js');
    const { enviarEmailReservaConfirmada } = require('../services/email.service.js');

    const mockDbClient = {
      query: jest.fn(),
      release: jest.fn(),
    };

    beforeEach(() => {
      jest.clearAllMocks();
      // Resetear la implementación del mock de query en cada test
      mockDbClient.query.mockReset();
      pool.connect.mockResolvedValue(mockDbClient);
    });

    it('debería procesar un pago aprobado, actualizar la BD y enviar email', async () => {
      payment.get.mockResolvedValue({
        id: mockPaymentId,
        status: 'approved',
        items: [{ id: mockReservaId }],
      });

      // Definir el comportamiento del mock específicamente para este test
      mockDbClient.query.mockImplementation(async (sql) => {
        if (sql.startsWith('SELECT estado_reserva')) return { rows: [{ estado_reserva: 'pendiente' }] };
        // Usar un string más específico para asegurar la coincidencia
        if (sql.includes('nombre_espacio')) return { rows: [{ id: mockReservaId, email: 'test@test.com' }] };
        return { rows: [] }; // Para BEGIN, UPDATE, COMMIT
      });

      const response = await request(app)
        .post('/pagos/webhook')
        .send({ type: 'payment', data: { id: mockPaymentId } });

      expect(payment.get).toHaveBeenCalledWith({ id: mockPaymentId });
      expect(pool.connect).toHaveBeenCalledTimes(1);
      expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockDbClient.query).toHaveBeenCalledWith('SELECT estado_reserva FROM reservas WHERE id = $1', [mockReservaId]);
      expect(mockDbClient.query).toHaveBeenCalledWith('UPDATE reservas SET estado_reserva = $1, estado_pago = $2 WHERE id = $3', ['confirmada', 'pagado', mockReservaId]);
      expect(enviarEmailReservaConfirmada).toHaveBeenCalledTimes(1);
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockDbClient.release).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(200);
    });

    it('no debería hacer nada si el tipo de notificación no es "payment"', async () => {
      const response = await request(app)
        .post('/pagos/webhook')
        .send({ type: 'other_event', data: { id: mockPaymentId } });

      expect(payment.get).not.toHaveBeenCalled();
      expect(pool.connect).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it('no debería hacer nada si el estado del pago no es "approved"', async () => {
      payment.get.mockResolvedValue({ status: 'rejected' });
      await request(app)
        .post('/pagos/webhook')
        .send({ type: 'payment', data: { id: mockPaymentId } });
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('no debería actualizar la BD si la reserva ya está confirmada', async () => {
      payment.get.mockResolvedValue({
        id: mockPaymentId,
        status: 'approved',
        items: [{ id: mockReservaId }],
      });
      // Comportamiento específico para este test
      mockDbClient.query.mockImplementation(async (sql) => {
        if (sql.startsWith('SELECT estado_reserva')) return { rows: [{ estado_reserva: 'confirmada' }] };
        return { rows: [] };
      });

      await request(app)
        .post('/pagos/webhook')
        .send({ type: 'payment', data: { id: mockPaymentId } });

      expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockDbClient.query).toHaveBeenCalledWith('SELECT estado_reserva FROM reservas WHERE id = $1', [mockReservaId]);
      expect(mockDbClient.query).not.toHaveBeenCalledWith(expect.stringMatching(/^UPDATE/));
      expect(mockDbClient.query).toHaveBeenCalledWith('COMMIT');
      expect(enviarEmailReservaConfirmada).not.toHaveBeenCalled();
      expect(mockDbClient.query).toHaveBeenCalledTimes(3);
    });

    it('debería hacer ROLLBACK si la actualización de la BD falla', async () => {
      payment.get.mockResolvedValue({
        id: mockPaymentId,
        status: 'approved',
        items: [{ id: mockReservaId }],
      });
      // Comportamiento específico para este test
      mockDbClient.query.mockImplementation(async (sql) => {
        if (sql.startsWith('SELECT estado_reserva')) return { rows: [{ estado_reserva: 'pendiente' }] };
        if (sql.startsWith('UPDATE')) throw new Error('Error de BD simulado');
        return { rows: [] };
      });

      const response = await request(app)
        .post('/pagos/webhook')
        .send({ type: 'payment', data: { id: mockPaymentId } });

      expect(mockDbClient.query).toHaveBeenCalledWith('BEGIN');
      // Es crucial verificar que se intentó la operación que falla.
      // Se usa una comprobación manual para evitar un posible bug en el matcher de Jest.
      const wasUpdateAttempted = mockDbClient.query.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].includes('UPDATE reservas')
      );
      expect(wasUpdateAttempted).toBe(true);

      // Y que la transacción se revirtió
      expect(mockDbClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockDbClient.query).not.toHaveBeenCalledWith('COMMIT');
      expect(response.status).toBe(500);
    });
  });

  describe('POST /procesar-pago', () => {
    const { payment } = require('../services/mercadopago.service.js');
    const pool = require('../db.js');
    const { enviarEmailReservaConfirmada } = require('../services/email.service.js');

    const mockDbClient = {
      query: jest.fn(),
      release: jest.fn(),
    };

    const mockPaymentRequest = {
      token: 'mock_token_123',
      issuer_id: 'mock_issuer_id',
      payment_method_id: 'visa',
      transaction_amount: 15000,
      installments: 1,
      payer: {
        email: 'test@payer.com',
        identification: { type: 'RUT', number: '12345678-9' },
      },
      reservaId: 'res-xyz-123',
    };

    beforeEach(() => {
      jest.clearAllMocks();
      mockDbClient.query.mockReset();
      pool.connect.mockResolvedValue(mockDbClient);
    });

    it('debería procesar un pago exitoso y confirmar la reserva', async () => {
      payment.create.mockResolvedValue({
        id: 'payment-123',
        status: 'approved',
      });
      // Proporcionar una simulación específica para este test
      mockDbClient.query.mockImplementation(async (sql) => {
        if (sql.includes('nombre_espacio')) {
          return { rows: [{ id: 'res-xyz-123', email: 'test@payer.com' }] };
        }
        return { rows: [] };
      });

      const response = await request(app)
        .post('/pagos/procesar-pago')
        .send(mockPaymentRequest);

      expect(payment.create).toHaveBeenCalledTimes(1);
      expect(pool.connect).toHaveBeenCalledTimes(1);
      expect(enviarEmailReservaConfirmada).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        status: 'approved',
        message: 'Pago procesado y reserva confirmada exitosamente.',
        paymentId: 'payment-123',
      });
    });

    it('debería manejar un pago rechazado', async () => {
      payment.create.mockResolvedValue({
        id: 'payment-456',
        status: 'rejected',
        status_detail: 'cc_rejected_other_reason',
      });

      const response = await request(app)
        .post('/pagos/procesar-pago')
        .send(mockPaymentRequest);

      expect(payment.create).toHaveBeenCalledTimes(1);
      expect(pool.connect).not.toHaveBeenCalled();
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        status: 'rejected',
        message: 'cc_rejected_other_reason',
        paymentId: 'payment-456',
      });
    });

    it('debería manejar un fallo de BD después de un pago aprobado', async () => {
      payment.create.mockResolvedValue({
        id: 'payment-789',
        status: 'approved',
      });
      // Forzar un error en la conexión a la BD
      pool.connect.mockRejectedValue(new Error('Error de conexión a la BD'));

      const response = await request(app)
        .post('/pagos/procesar-pago')
        .send(mockPaymentRequest);

      expect(payment.create).toHaveBeenCalledTimes(1);
      expect(pool.connect).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        status: 'approved_but_confirmation_failed',
        message: 'El pago fue exitoso, pero ocurrió un error al confirmar la reserva.',
        paymentId: 'payment-789',
      });
    });

    it('debería retornar 400 si falta el token en la solicitud', async () => {
      const { token, ...incompleteRequest } = mockPaymentRequest;
      const response = await request(app)
        .post('/pagos/procesar-pago')
        .send(incompleteRequest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('El campo "token" es requerido.');
    });
  });
});
