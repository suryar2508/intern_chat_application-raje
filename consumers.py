import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import ChatMessage
from django.contrib.auth.models import User
from django.utils import timezone

class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_group_name = "chat_global_chat"
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        data = json.loads(text_data)
        msg_type = data.get('msg_type')

        # --- RTC SIGNALING (BYPASS DATABASE) ---
        if msg_type in ['rtc_offer', 'rtc_answer', 'rtc_candidate']:
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat_message', # Re-use sender logic
                    **data # Send the offer/answer/candidate
                }
            )
            return # Don't save WebRTC signals to DB

        # --- NORMAL CHAT LOGIC ---
        await self.save_message(data)
        now_local = timezone.localtime(timezone.now())
        
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'message': data.get('message'),
                'username': data.get('username'),
                'msg_type': msg_type,
                'media_url': data.get('media_url', ''),
                'timestamp': f"Today, {now_local.strftime('%H:%M:%S')}"
            }
        )
    
    @database_sync_to_async
    def save_message(self, data):
        user = User.objects.get(username=data.get('username'))
        return ChatMessage.objects.create(
            user=user,
            message=data.get('message', ''),
            msg_type=data.get('msg_type', 'text'),
            media_url=data.get('media_url', '')
        )

    async def chat_message(self, event):
        await self.send(text_data=json.dumps(event))


