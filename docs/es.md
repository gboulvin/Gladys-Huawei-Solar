# Huawei Solar para Gladys Assistant

Supervise y controle su instalación solar Huawei desde Gladys: inversores
**SUN2000**, baterías **LUNA2000** y el medidor **DTSU666-H / DDSU666-H**
conectado al inversor.

Hay dos conexiones disponibles, por separado o juntas:

| Conexión  | Cómo                                                           | Actualización          | Órdenes |
| --------- | -------------------------------------------------------------- | ---------------------- | ------- |
| **Local** | Modbus TCP mediante el SDongle, un EMMA o el WLAN del inversor | cada 30 s o más        | sí      |
| **Nube**  | API Northbound de FusionSolar                                  | cada 5 min como máximo | no      |

Con ambas, el interruptor **Preferir la conexión local** elige la preferida;
si falla, la otra toma el relevo y la insignia de los dispositivos muestra un
punto naranja.

Requiere **Gladys 5.1.0** o posterior.

## 1. Conexión local (recomendada)

1. En la **app FusionSolar**, abra la _Puesta en servicio_ de su inversor
   (acceso de instalador), luego _Ajustes > Configuración de comunicación >
   Parámetros del Dongle > Modbus TCP_ y elija **Activar (sin restricción)**.
2. Asigne una IP fija al SDongle en su router.
3. En Gladys, indique:
   - **Dirección del inversor / SDongle**: la IP del SDongle, p. ej.
     `192.168.1.50`;
   - **Puerto Modbus**: `502` (SDongle / EMMA), `6607` (WLAN del inversor);
   - **Unit id Modbus**: normalmente `1` (SDongle), `0` (WLAN del inversor).
4. Pulse **Probar la conexión**.

Conviene saber:

- el SDongle solo acepta unos pocos clientes Modbus simultáneos: si otro
  sistema domótico ya lo lee, mantenga un intervalo de 60 s o más;
- algunas órdenes (limitación de inyección, arranque / apagado del inversor)
  pueden requerir permisos de instalador según el firmware: la acción de
  escena responde entonces `success: false` con el mensaje del inversor.

## 2. Conexión en la nube (FusionSolar)

La nube usa la **API Northbound** de FusionSolar, que necesita una cuenta API
dedicada: su usuario habitual de la app **no sirve**.

1. Pida a su instalador que cree una cuenta API en FusionSolar
   (_Sistema > Gestión de empresa > Gestión Northbound_), con acceso a su
   planta.
2. En Gladys, indique:
   - **Servidor FusionSolar**: la dirección que usa en el navegador, p. ej.
     `https://eu5.fusionsolar.huawei.com`;
   - **Usuario de la API** y **Contraseña API (system code)**.
3. Pulse **Probar la conexión**.

Huawei limita el número de llamadas a la API: la nube se lee cada 5 minutos
como máximo, sea cual sea el intervalo de actualización.

## 3. Crear los dispositivos

Abra la pestaña **Descubrimiento** de la integración y cree los dispositivos
encontrados:

- **Huawei SUN2000…** (inversor): producción solar (W), producción total
  (kWh), producción de hoy (kWh), potencia de entrada FV (W), temperatura
  interna, estado;
- **Huawei power meter** (medidor): potencia de red (W, positiva al consumir
  de la red, negativa al inyectar), potencias (W) e índices (kWh) de consumo /
  inyección, consumo de la casa (W), tensión, corriente;
- **Huawei LUNA2000 battery** (batería): nivel (%), potencia de carga /
  descarga (W), total cargado / descargado (kWh, en local), energía restante
  (kWh, en local), estado, **modo de funcionamiento** (modificable desde
  Gladys con la conexión local: maximizar autoconsumo, por franjas horarias,
  inyección total a la red).

Los índices de producción y de red alimentan el seguimiento de energía de
Gladys.

## 4. Escenas

**Disparadores** (categoría _Integraciones_):

- **Cambio de estado del inversor**: la producción empieza, se detiene, el
  inversor entra en avería… Variables: `status`, `previous_status`,
  `production_power`.
- **Cambio en el intercambio con la red**: la casa empieza a **inyectar**
  excedente, a **consumir** de la red, o está **equilibrada** (banda muerta
  ajustable en la configuración, 100 W por defecto). Ideal para arrancar un
  termo o un cargador de coche con excedente. Variables: `flow`,
  `previous_flow`, `grid_power`.
- **Nivel de batería cruzado**: la batería sube o baja de un nivel, en pasos
  del 10 %. Variables: `direction`, `level`, `battery_level`.

**Acciones** (conexión local, salvo la última):

- forzar la **carga** o la **descarga** de la batería (potencia, duración),
  **detener** el forzado;
- cambiar el **modo de funcionamiento** de la batería;
- **limitar la inyección a la red**: sin límite, inyección cero o límite en
  vatios;
- **arrancar o apagar** el inversor;
- **leer la instalación solar**: expone `production_power`,
  `daily_production`, `house_power`, `grid_power`, `battery_level`,
  `battery_power` e `inverter_status` a las acciones siguientes.

Cada orden devuelve `success` y `message`: use una condición sobre `success`
para reaccionar a un fallo.

## 5. Widgets del panel

- **Resumen solar**: producción, casa, red y batería en directo, curva del
  día, estado del inversor, producción de hoy, intercambio con la red y
  conexión.
- **Control de batería**: nivel, potencia de carga y descarga, modo de
  funcionamiento, y botones para forzar una carga o una descarga, detenerla o
  cambiar el modo.

## Solución de problemas

- _Cannot connect to …:502_: Modbus TCP no está activado en el dongle, la IP
  es incorrecta o el dongle está ocupado por otro cliente.
- _illegal data address_: el registro no existe en su modelo (p. ej. sin
  batería): la integración lo ignora al leer.
- _FusionSolar login refused_: compruebe la dirección del servidor, el
  usuario de la API y el system code; una cuenta normal no sirve.
- _rate limit reached_: espere unos minutos y use esta cuenta API desde una
  sola integración.
