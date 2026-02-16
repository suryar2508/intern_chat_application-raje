from rest_framework import status
from django.contrib.auth.models import User
from rest_framework.decorators import api_view, permission_classes, parser_classes 
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from django.core.files.storage import default_storage
from rest_framework.parsers import MultiPartParser, FormParser
from django.utils import timezone 
from datetime import timedelta # Added for Yesterday logic

# Ensure this model exists in your models.py
from .models import ChatMessage 

@api_view(['POST'])
@permission_classes([AllowAny])
def register_view(request):
    username = request.data.get('username')
    password = request.data.get('password')
    
    if not username or not password:
        return Response({"error": "Username and password required"}, status=status.HTTP_400_BAD_REQUEST)
    
    if User.objects.filter(username=username).exists():
        return Response({"error": "Username already exists"}, status=status.HTTP_400_BAD_REQUEST)
    
    User.objects.create_user(username=username, password=password)
    return Response({"message": "User created successfully"}, status=status.HTTP_201_CREATED)

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def protected_view(request):
    return Response({"message": f"Hello {request.user.username}!"})

@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def upload_file_view(request):
    if 'file' not in request.FILES:
        return Response({"error": "No file provided"}, status=status.HTTP_400_BAD_REQUEST)
    
    file_obj = request.FILES['file']
    file_name = default_storage.save(f"uploads/{file_obj.name}", file_obj)
    file_url = default_storage.url(file_name)
    
    return Response({"file": file_url}, status=status.HTTP_201_CREATED)

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_chat_history(request):
    # Retrieve the last 50 messages
    messages = ChatMessage.objects.all().order_by('-timestamp')[:50]
    
    # Get current local date in Chennai (Asia/Kolkata)
    now_local = timezone.localtime(timezone.now())
    today = now_local.date()
    yesterday = today - timedelta(days=1)
    
    data = []
    # Reverse to show oldest first in the UI
    for m in reversed(messages):
        # Force conversion to the local time set in settings.py (Asia/Kolkata)
        local_datetime = timezone.localtime(m.timestamp)
        msg_date = local_datetime.date()
        msg_time = local_datetime.strftime("%H:%M:%S")

        # Determine the label based on the date comparison
        if msg_date == today:
            display_timestamp = f"Today, {msg_time}"
        elif msg_date == yesterday:
            display_timestamp = f"Yesterday, {msg_time}"
        else:
            # For older messages, show the full date
            display_timestamp = local_datetime.strftime("%d %b, %H:%M:%S")
        
        data.append({
            "username": m.user.username,
            "message": m.message,
            "msg_type": m.msg_type,
            "media_url": m.media_url,
            "timestamp": display_timestamp 
        })
    return Response(data)
