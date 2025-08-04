# ml_scripts/video_gen_text.py
import sys
import os
import subprocess
from PIL import Image, ImageDraw, ImageFont
import torch
import time
from diffusers import StableDiffusionPipeline # Using the same library as image_gen.py

def generate_video_from_text(prompt, content_id):
    # --- Paths and Setup ---
    # Ensure FFMPEG_EXE_PATH is correct for your system
    FFMPEG_EXE_PATH = "C:\\ffmpeg\\ffmpeg-master-latest-win64-gpl\\bin\\ffmpeg.exe" # <--- CONFIRM THIS IS YOUR CORRECT FFMPEG PATH

    output_video_dir = os.path.join(os.path.dirname(__file__), '..', 'storage', 'videos')
    temp_frames_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'uploads', f'temp_video_frames_{content_id}') # Unique temp dir

    if not os.path.exists(output_video_dir):
        os.makedirs(output_video_dir)
    if not os.path.exists(temp_frames_dir):
        os.makedirs(temp_frames_dir)

    output_video_filename = f"video_text_{content_id}.mp4"
    output_video_path = os.path.join(output_video_dir, output_video_filename)

    # --- Stable Diffusion Model Setup (CPU-only) ---
    try:
        # Load the model only once
        pipeline = StableDiffusionPipeline.from_pretrained("runwayml/stable-diffusion-v1-5", torch_dtype=torch.float32)
        pipeline.to("cpu")
        sys.stderr.write("Running video generation on CPU. This will be very slow.\n")
    except Exception as e:
        sys.stderr.write(f"Error loading Stable Diffusion model: {e}\n")
        sys.exit(1)

    # --- Video Generation Parameters ---
    num_frames = 15  # Generate 15 frames for a ~5 second video at 3 FPS
    fps = 3          # Frames per second for the final video

    # Create slightly varied prompts for each frame to encourage visual change
    base_prompts = [
        f"{prompt}, wide shot, cinematic",
        f"{prompt}, close up, detailed",
        f"{prompt}, with dramatic lighting",
        f"{prompt}, from a low angle, epic",
        f"{prompt}, with soft, natural light",
        f"{prompt}, a slightly different perspective",
        f"{prompt}, in a dreamlike style",
        f"{prompt}, with a subtle shift in color palette",
        f"{prompt}, a different time of day",
        f"{prompt}, with a foreground element",
        f"{prompt}, an abstract interpretation",
        f"{prompt}, highly textured, artistic",
        f"{prompt}, with a shallow depth of field",
        f"{prompt}, a panoramic view",
        f"{prompt}, extreme close-up, intricate details"
    ]

    # --- 1. Generate a Sequence of Images (Frames) ---
    generated_frame_paths = []
    for i in range(num_frames):
        current_prompt_index = i % len(base_prompts) # Cycle through base prompts
        current_prompt = base_prompts[current_prompt_index]

        sys.stderr.write(f"Generating frame {i+1}/{num_frames} from prompt: '{current_prompt}'\n")
        try:
            image = pipeline(current_prompt, num_inference_steps=20).images[0] # Lower steps for faster (but lower quality) frames

            frame_filename = f"frame_{i:03d}.png" # e.g., frame_000.png, frame_001.png
            frame_path = os.path.join(temp_frames_dir, frame_filename)
            image.save(frame_path)
            generated_frame_paths.append(frame_path)
        except Exception as e:
            sys.stderr.write(f"Error generating frame {i+1}: {e}\n")
            sys.exit(1)

    # --- 2. Combine Images into a Video using FFmpeg ---
    try:
        ffmpeg_command = [
            FFMPEG_EXE_PATH,
            '-framerate', str(fps),          # Set the frame rate for input images
            '-i', os.path.join(temp_frames_dir, 'frame_%03d.png'),  # Input pattern for numbered images
            '-c:v', 'libx264',               # Video codec
            '-r', '30',                      # Output video framerate (standard for playback)
            '-pix_fmt', 'yuv420p',           # Pixel format for compatibility
            '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p', # Scale and pad to 720p, ensure yuv420p
            '-y',                            # Overwrite output file without asking
            output_video_path
        ]
        sys.stderr.write(f"Running FFmpeg command to combine frames: {' '.join(ffmpeg_command)}\n")

        process = subprocess.run(ffmpeg_command, capture_output=True, text=True, check=False)

        if process.returncode != 0:
            sys.stderr.write(f"FFmpeg failed with error:\n{process.stderr}\n")
            sys.exit(1)
        else:
            sys.stderr.write(f"FFmpeg stdout:\n{process.stdout}\n")
            sys.stderr.write(f"Video generated at: {output_video_path}\n")

    except FileNotFoundError:
        sys.stderr.write("Error: FFmpeg not found at the specified path. Please check FFMPEG_EXE_PATH in the script.\n")
        sys.exit(1)
    except Exception as e:
        sys.stderr.write(f"Error during FFmpeg conversion: {e}\n")
        sys.exit(1)
    finally:
        # Clean up temporary frames directory
        for frame_path in generated_frame_paths:
            if os.path.exists(frame_path):
                try:
                    os.remove(frame_path)
                except Exception as e:
                    sys.stderr.write(f"Error cleaning up frame {frame_path}: {e}\n")
        if os.path.exists(temp_frames_dir):
            try:
                os.rmdir(temp_frames_dir) # Remove the directory if empty
            except OSError: # rmdir only removes empty dirs
                sys.stderr.write(f"Could not remove temporary directory {temp_frames_dir} (may not be empty).\n")
            except Exception as e:
                sys.stderr.write(f"Error removing temp directory {temp_frames_dir}: {e}\n")

    print(f"storage/videos/{output_video_filename}")

if __name__ == "__main__":
    if len(sys.argv) > 2:
        prompt_arg = sys.argv[1]
        content_id_arg = sys.argv[2]
        generate_video_from_text(prompt_arg, content_id_arg)
    else:
        sys.stderr.write("Usage: python video_gen_text.py <prompt> <content_id>\n")
        sys.exit(1)
        
        
# # ml_scripts/video_gen_text.py
# import sys
# import os
# import subprocess
# from PIL import Image, ImageDraw, ImageFont
# import time

# def generate_video_from_text(prompt, content_id):
#     output_dir = os.path.join(os.path.dirname(__file__), '..', 'storage', 'videos')
#     temp_image_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'uploads', 'temp_images')

#     if not os.path.exists(output_dir):
#         os.makedirs(output_dir)
#     if not os.path.exists(temp_image_dir):
#         os.makedirs(temp_image_dir)

#     temp_image_filename = f"temp_frame_{content_id}.png"
#     temp_image_path = os.path.join(temp_image_dir, temp_image_filename)

#     output_video_filename = f"video_text_{content_id}.mp4"
#     output_video_path = os.path.join(output_dir, output_video_filename)

#     # 1. Create a temporary image with the prompt text
#     try:
#         img_width, img_height = 1280, 720
#         img = Image.new('RGB', (img_width, img_height), color = 'lightblue')
#         d = ImageDraw.Draw(img)

#         try:
#             font_path = "arial.ttf"
#             font_size = 40
#             font = ImageFont.truetype(font_path, font_size)
#         except IOError:
#             sys.stderr.write("Warning: Arial font not found. Using default PIL font (may not display well).\n")
#             font = ImageFont.load_default()
#             font_size = 20

#         text = f"Prompt: {prompt}"
#         if len(text) > 40:
#             text_lines = []
#             words = text.split(' ')
#             current_line = ""
#             for word in words:
#                 if len(current_line) + len(word) + 1 > 40:
#                     text_lines.append(current_line)
#                     current_line = word
#                 else:
#                     current_line += (" " if current_line else "") + word
#             text_lines.append(current_line)
#             text = "\n".join(text_lines)

#         bbox = d.textbbox((0, 0), text, font=font)
#         text_width = bbox[2] - bbox[0]
#         text_height = bbox[3] - bbox[1]
#         x = (img_width - text_width) / 2
#         y = (img_height - text_height) / 2

#         d.text((x, y), text, fill=(0,0,0), font=font)
#         img.save(temp_image_path)
#         sys.stderr.write(f"Temporary image created at: {temp_image_path}\n")
#     except Exception as e:
#         sys.stderr.write(f"Error creating temporary image: {e}\n")
#         sys.exit(1)

#     # 2. Use FFmpeg to convert the image to a video
#     try:
#         # === IMPORTANT CHANGE HERE: REPLACE 'ffmpeg' WITH THE ABSOLUTE PATH ===
#         FFMPEG_EXE_PATH = "C:\\ffmpeg\\ffmpeg-master-latest-win64-gpl\\bin\\ffmpeg.exe"
#         # FFMPEG_EXE_PATH = "C:\ffmpeg\ffmpeg-master-latest-win64-gpl\bin" # <--- YOU MUST REPLACE THIS LINE

#         ffmpeg_command = [
#             FFMPEG_EXE_PATH,         # Use the explicit path
#             '-loop', '1',
#             '-i', temp_image_path,
#             '-c:v', 'libx264',
#             '-t', '5',
#             '-pix_fmt', 'yuv420p',
#             '-vf', f'scale={img_width}:{img_height}',
#             '-y',
#             output_video_path
#         ]
#         sys.stderr.write(f"Running FFmpeg command: {' '.join(ffmpeg_command)}\n")

#         process = subprocess.run(ffmpeg_command, capture_output=True, text=True, check=False)

#         if process.returncode != 0:
#             sys.stderr.write(f"FFmpeg failed with error:\n{process.stderr}\n")
#             sys.exit(1)
#         else:
#             sys.stderr.write(f"FFmpeg stdout:\n{process.stdout}\n")
#             sys.stderr.write(f"Video generated at: {output_video_path}\n")

#     except FileNotFoundError:
#         sys.stderr.write("Error: FFmpeg not found at the specified path. Please check FFMPEG_EXE_PATH in the script.\n")
#         sys.exit(1)
#     except Exception as e:
#         sys.stderr.write(f"Error during FFmpeg conversion: {e}\n")
#         sys.exit(1)
#     finally:
#         if os.path.exists(temp_image_path):
#             try:
#                 os.remove(temp_image_path)
#                 sys.stderr.write(f"Cleaned up temporary image: {temp_image_path}\n")
#             except Exception as e:
#                 sys.stderr.write(f"Error cleaning up temp image: {e}\n")

#     print(f"storage/videos/{output_video_filename}")

# if __name__ == "__main__":
#     if len(sys.argv) > 2:
#         prompt_arg = sys.argv[1]
#         content_id_arg = sys.argv[2]
#         generate_video_from_text(prompt_arg, content_id_arg)
#     else:
#         sys.stderr.write("Usage: python video_gen_text.py <prompt> <content_id>\n")
#         sys.exit(1)



# # ml_scripts/video_gen_text.py
# import sys
# import os
# import subprocess # To run ffmpeg command
# from PIL import Image, ImageDraw, ImageFont # For drawing text on image
# import time # For simulating processing if needed, though ffmpeg will take its own time

# def generate_video_from_text(prompt, content_id):
#     output_dir = os.path.join(os.path.dirname(__file__), '..', 'storage', 'videos')
#     temp_image_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'uploads', 'temp_images')

#     if not os.path.exists(output_dir):
#         os.makedirs(output_dir)
#     if not os.path.exists(temp_image_dir):
#         os.makedirs(temp_image_dir)

#     temp_image_filename = f"temp_frame_{content_id}.png"
#     temp_image_path = os.path.join(temp_image_dir, temp_image_filename)

#     output_video_filename = f"video_text_{content_id}.mp4"
#     output_video_path = os.path.join(output_dir, output_video_filename)

#     # 1. Create a temporary image with the prompt text
#     try:
#         img_width, img_height = 1280, 720 # Standard HD resolution
#         img = Image.new('RGB', (img_width, img_height), color = 'lightblue')
#         d = ImageDraw.Draw(img)

#         # Try to load a default font, or fallback
#         try:
#             # Common Windows font paths, adjust for other OS if needed
#             font_path = "arial.ttf" # Or "C:/Windows/Fonts/arial.ttf"
#             font_size = 40
#             font = ImageFont.truetype(font_path, font_size)
#         except IOError:
#             sys.stderr.write("Warning: Arial font not found. Using default PIL font (may not display well).\n")
#             font = ImageFont.load_default()
#             font_size = 20 # Adjust size for default font

#         text = f"Prompt: {prompt}"
#         # Wrap text if too long
#         if len(text) > 40: # Arbitrary wrap length
#             text = ""
#             for i in range(0, len(f"Prompt: {prompt}"), 40):
#                 text += f"Prompt: {prompt}"[i:i+40] + "\n"

#         # Calculate text size and position to center it
#         bbox = d.textbbox((0, 0), text, font=font)
#         text_width = bbox[2] - bbox[0]
#         text_height = bbox[3] - bbox[1]
#         x = (img_width - text_width) / 2
#         y = (img_height - text_height) / 2

#         d.text((x, y), text, fill=(0,0,0), font=font) # Black text
#         img.save(temp_image_path)
#         sys.stderr.write(f"Temporary image created at: {temp_image_path}\n")
#     except Exception as e:
#         sys.stderr.write(f"Error creating temporary image: {e}\n")
#         sys.exit(1)

#     # 2. Use FFmpeg to convert the image to a video
#     try:
#         ffmpeg_command = [
#             'ffmpeg',
#             '-loop', '1',              # Loop the input image indefinitely
#             '-i', temp_image_path,     # Input image file
#             '-c:v', 'libx264',         # Video codec
#             '-t', '5',                 # Duration of the video (5 seconds)
#             '-pix_fmt', 'yuv420p',     # Pixel format for compatibility
#             '-vf', f'scale={img_width}:{img_height}', # Ensure video resolution matches image
#             '-y',                      # Overwrite output file without asking
#             output_video_path          # Output video file
#         ]
#         sys.stderr.write(f"Running FFmpeg command: {' '.join(ffmpeg_command)}\n")

#         # Execute FFmpeg command
#         process = subprocess.run(ffmpeg_command, capture_output=True, text=True, check=False)

#         if process.returncode != 0:
#             sys.stderr.write(f"FFmpeg failed with error:\n{process.stderr}\n")
#             sys.exit(1)
#         else:
#             sys.stderr.write(f"FFmpeg stdout:\n{process.stdout}\n")
#             sys.stderr.write(f"Video generated at: {output_video_path}\n")

#     except FileNotFoundError:
#         sys.stderr.write("Error: FFmpeg not found. Please ensure FFmpeg is installed and in your system's PATH.\n")
#         sys.exit(1)
#     except Exception as e:
#         sys.stderr.write(f"Error during FFmpeg conversion: {e}\n")
#         sys.exit(1)
#     finally:
#         # Clean up the temporary image file
#         if os.path.exists(temp_image_path):
#             try:
#                 os.remove(temp_image_path)
#                 sys.stderr.write(f"Cleaned up temporary image: {temp_image_path}\n")
#             except Exception as e:
#                 sys.stderr.write(f"Error cleaning up temp image: {e}\n")

#     # Print the relative path that Express will serve to stdout
#     print(f"storage/videos/{output_video_filename}")

# if __name__ == "__main__":
#     if len(sys.argv) > 2:
#         prompt_arg = sys.argv[1]
#         content_id_arg = sys.argv[2]
#         generate_video_from_text(prompt_arg, content_id_arg)
#     else:
#         sys.stderr.write("Usage: python video_gen_text.py <prompt> <content_id>\n")
#         sys.exit(1)
        
        
        
# # ml_scripts/video_gen_text.py
# import sys
# import os
# import time
# # You would need libraries like OpenCV (cv2), numpy, etc., for actual video creation.
# # For advanced ML, you'd integrate with models from Hugging Face Transformers, PyTorch, etc.

# def generate_video_from_text(prompt, content_id):
#     """
#     Conceptual function to generate a video from a text prompt.
#     In a real scenario, this would involve a complex ML model.
#     """
#     output_dir = os.path.join(os.path.dirname(__file__), '..', 'storage', 'videos')
#     if not os.path.exists(output_dir):
#         os.makedirs(output_dir)

#     output_filename = f"video_text_{content_id}.mp4"
#     output_path = os.path.join(output_dir, output_filename)

#     # Simulate video generation time
#     time.sleep(5) # Simulate a 5-second processing time

#     # --- CONCEPTUAL VIDEO CREATION ---
#     # This is a dummy video file creation. A real implementation would:
#     # 1. Use an ML model to generate frames based on the prompt.
#     # 2. Use a library like OpenCV (cv2) or imageio to combine frames into a video.
#     try:
#         # Dummy MP4 file creation (very basic, might not play universally without actual encoding)
#         # This is not a real video encoding, just creating a file.
#         # For a real, simple video: you might use FFmpeg from Python via subprocess,
#         # or a Python wrapper for FFmpeg like 'moviepy'.
#         with open(output_path, 'wb') as f:
#             f.write(b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom\x00\x00\x00\x00\x00\x00\x00\x00')
#             f.write(f"This is a dummy video for prompt: {prompt}".encode())
#             # A real video file needs proper header and frame data
#             # For demonstration, this is just a placeholder.
#             # Actual video encoding is complex!
#             # Example using ffmpeg through command line (similar to file-to-video in Node.js):
#             # import subprocess
#             # dummy_image_path = os.path.join(output_dir, f"temp_frame_{content_id}.png")
#             # Image.new('RGB', (640, 480), color = 'blue').save(dummy_image_path)
#             # cmd = [
#             #     'ffmpeg', '-loop', '1', '-i', dummy_image_path,
#             #     '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
#             #     output_path
#             # ]
#             # subprocess.run(cmd, check=True)
#             # os.remove(dummy_image_path) # Clean up temp image

#     except Exception as e:
#         sys.stderr.write(f"Error creating dummy video file: {e}\n")
#         sys.exit(1)


#     # Print the relative path that Express will serve
#     # This path must match what your Node.js backend expects
#     print(f"storage/videos/{output_filename}")

# if __name__ == "__main__":
#     if len(sys.argv) > 2:
#         prompt_arg = sys.argv[1]
#         content_id_arg = sys.argv[2]
#         generate_video_from_text(prompt_arg, content_id_arg)
#     else:
#         sys.stderr.write("Usage: python video_gen_text.py <prompt> <content_id>\n")
#         sys.exit(1)