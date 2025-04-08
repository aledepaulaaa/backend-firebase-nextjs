import type { NextApiRequest, NextApiResponse } from 'next';
import { firestoreDb, messaging } from '../../lib/firebaseAdmin';

interface TraccarEvent {
    id: number;
    deviceId: number;
    type: string;
    eventTime: string;
    attributes?: Record<string, any>;
    geofenceId?: number;
    maintenanceId?: number;
    positionId?: number;
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    try {
        const event = req.body as TraccarEvent;
        console.log(`Recebido evento do Traccar: ${event.type} para dispositivo ${event.deviceId}`);

        // Buscar informações do dispositivo no Firestore (se necessário)
        // Isso depende de como você está armazenando os dados dos dispositivos
        const deviceDoc = await firestoreDb.collection('devices').doc(String(event.deviceId)).get();
        const deviceData = deviceDoc.exists ? deviceDoc.data() : null;

        // Buscar tokens FCM associados ao dispositivo ou usuário
        let tokens: string[] = [];

        if (deviceData?.userId) {
            const userDoc = await firestoreDb.collection('token-usuarios').doc(deviceData.userId).get();
            tokens = userDoc.exists ? (userDoc.data()?.fcmTokens || []) : [];
        }

        if (tokens.length === 0) {
            console.log(`Nenhum token encontrado para o dispositivo ${event.deviceId}`);
            return res.status(200).json({ success: false, message: 'No tokens found' });
        }

        // Determinar o título e corpo da notificação com base no tipo de evento
        let title = 'Notificação do Rastreador';
        let body = '';

        const deviceName = deviceData?.name || `Dispositivo ${event.deviceId}`;

        switch (event.type) {
            case 'deviceOnline':
                title = 'Dispositivo Conectado';
                body = `${deviceName} está agora online.`;
                break;
            case 'deviceOffline':
                title = 'Dispositivo Desconectado';
                body = `${deviceName} está agora offline.`;
                break;
            case 'ignitionOn':
                title = 'Ignição Ligada';
                body = `A ignição de ${deviceName} foi ligada.`;
                break;
            case 'ignitionOff':
                title = 'Ignição Desligada';
                body = `A ignição de ${deviceName} foi desligada.`;
                break;
            case 'geofenceEnter':
                // Buscar nome da geocerca se necessário
                const geofenceName = event.geofenceId ? `Geocerca ${event.geofenceId}` : 'uma geocerca';
                title = 'Entrada em Geocerca';
                body = `${deviceName} entrou em ${geofenceName}.`;
                break;
            case 'geofenceExit':
                const exitGeofenceName = event.geofenceId ? `Geocerca ${event.geofenceId}` : 'uma geocerca';
                title = 'Saída de Geocerca';
                body = `${deviceName} saiu de ${exitGeofenceName}.`;
                break;
            default:
                title = `Evento: ${event.type}`;
                body = `Novo evento para ${deviceName}.`;
        }

        // Enviar notificação push
        const message = {
            notification: {
                title,
                body,
            },
            data: {
                eventType: event.type,
                deviceId: String(event.deviceId),
                eventTime: event.eventTime,
                // Adicione outros dados relevantes aqui
            },
            tokens: tokens,
        };

        const response = await messaging.sendEachForMulticast(message);
        console.log(`Notificação enviada: ${response.successCount} sucessos, ${response.failureCount} falhas.`);

        return res.status(200).json({
            success: true,
            sent: response.successCount,
            failed: response.failureCount
        });
    } catch (error: any) {
        console.error('Erro ao processar evento do Traccar:', error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
