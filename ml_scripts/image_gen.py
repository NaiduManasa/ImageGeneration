# ml_scripts/image_gen.py
import sys
import os
from diffusers import StableDiffusionPipeline
import torch
# import intel_extension_for_pytorch as ipex # <--- REMOVED THIS LINE
from PIL import Image

def generate_image(prompt, content_id):
    # 1. Load the Stable Diffusion Model
    try:
        # Use float32 for CPU compatibility (float16 is for most GPUs)
        # This will download the model weights (~5GB) the first time it runs.
        pipeline = StableDiffusionPipeline.from_pretrained("runwayml/stable-diffusion-v1-5", torch_dtype=torch.float32)
    except Exception as e:
        sys.stderr.write(f"Error loading Stable Diffusion model: {e}\n")
        sys.exit(1)

    # 2. Force pipeline to CPU
    # No IPEX optimization as we are not using it.
    pipeline.to("cpu")
    sys.stderr.write("Running image generation on CPU. This will be very slow.\n") # <--- IMPORTANT MESSAGE


    # 3. Generate the Image
    try:
        # You can add more generation parameters here (num_inference_steps, guidance_scale, negative_prompt etc.)
        image = pipeline(prompt).images[0]
    except Exception as e:
        sys.stderr.write(f"Error during image generation: {e}\n")
        sys.exit(1)

    # 4. Save the Image
    output_dir = os.path.join(os.path.dirname(__file__), '..', 'storage', 'images')
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    output_filename = f"image_{content_id}.png"
    output_path = os.path.join(output_dir, output_filename)

    try:
        image.save(output_path)
        print(f"storage/images/{output_filename}") # Print to stdout for Node.js to capture
    except Exception as e:
        sys.stderr.write(f"Error saving generated image: {e}\n")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) > 2:
        prompt_arg = sys.argv[1]
        content_id_arg = sys.argv[2]
        generate_image(prompt_arg, content_id_arg)
    else:
        sys.stderr.write("Usage: python image_gen.py <prompt> <content_id>\n")
        sys.exit(1)
        
