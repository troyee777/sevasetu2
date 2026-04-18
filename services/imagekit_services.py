from imagekitio import ImageKit
import os
import io
import base64

try:
    import fitz
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False
    print("PyMuPDF not installed. PDF thumbnails skipped. Run: pip install pymupdf")

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

imagekit = ImageKit(
    private_key  = os.environ.get("IMAGEKIT_PRIVATE_KEY"),
    #public_key   = os.environ.get("IMAGEKIT_PUBLIC_KEY"),
    #url_endpoint = os.environ.get("IMAGEKIT_URL_ENDPOINT")
)

def _upload_bytes(file_bytes, filename, folder):
    try:
        encoded = base64.b64encode(file_bytes).decode("utf-8")
        result = imagekit.files.upload(
            file      = file_bytes,
            file_name = filename,
            
                folder=             folder,
                is_private_file=      False,
                use_unique_file_name= True
        )
        if isinstance(result, dict):
            inner   = result.get("response", result)
            url     = inner.get("url") or inner.get("URL")
            file_id = inner.get("fileId") or inner.get("file_id") or inner.get("id")
        else:
            url     = getattr(result, "url",     None) or getattr(result, "URL",    None)
            file_id = getattr(result, "file_id", None) or getattr(result, "fileId", None) or getattr(result, "id", None)
        if not url:
            print(f"Upload OK but URL missing. Result: {result}")
            return None
        print(f"ImageKit OK -> {url}")
        return {"url": url, "fileId": file_id}
    except Exception as e:
        print(f"ImageKit upload failed ({filename}): {e}")
        return None

def _file_to_bytes(file):
    file.seek(0)
    return file.read()

def _pil_to_bytes(pil_image, fmt="JPEG", quality=90):
    buf = io.BytesIO()
    pil_image.save(buf, format=fmt, quality=quality)
    buf.seek(0)
    return buf.read()

def _pdf_first_page_to_pil(pdf_bytes, dpi=200):
    if not PYMUPDF_AVAILABLE:
        return None
    try:
        doc  = fitz.open(stream=pdf_bytes, filetype="pdf")
        page = doc.load_page(0)
        mat  = fitz.Matrix(dpi/72, dpi/72)
        pix  = page.get_pixmap(matrix=mat, alpha=False)
        img  = Image.frombytes("RGB", [pix.width, pix.height], pix.samples) if PIL_AVAILABLE else None
        doc.close()
        return img
    except Exception as e:
        print(f"PDF->image failed: {e}")
        return None

def upload_report(ngo_uid, file):
    ext       = os.path.splitext(file.filename or "report.jpg")[1].lower()
    folder    = f"Home/SevaSetu/reports/{ngo_uid}"
    raw_bytes = _file_to_bytes(file)
    original  = _upload_bytes(raw_bytes, f"report_{os.urandom(4).hex()}{ext}", folder)
    if not original:
        return None
    thumb_url, thumb_file_id = original["url"], original["fileId"]
    if ext == ".pdf":
        pil = _pdf_first_page_to_pil(raw_bytes)
        if pil and PIL_AVAILABLE:
            thumb = _upload_bytes(_pil_to_bytes(pil, fmt="JPEG", quality=92),
                                  f"thumb_{os.urandom(4).hex()}.jpg",
                                  folder + "/thumbs")
            if thumb:
                thumb_url, thumb_file_id = thumb["url"], thumb["fileId"]
    return {"url": original["url"], "fileId": original["fileId"],
            "thumb_url": thumb_url, "thumb_fileId": thumb_file_id}

def upload_ngo_logo(ngo_uid, file):
    return _upload_bytes(_file_to_bytes(file),
                         f"logo_{ngo_uid}_{os.urandom(3).hex()}.jpg",
                         f"Home/SevaSetu/ngo/{ngo_uid}")

def upload_volunteer_avatar(vol_uid, file):
    ext = os.path.splitext(file.filename or ".jpg")[1].lower() or ".jpg"
    return _upload_bytes(_file_to_bytes(file),
                         f"avatar_{vol_uid}_{os.urandom(3).hex()}{ext}",
                         f"Home/SevaSetu/volunteers/{vol_uid}/profile")

def upload_user_profile(uid, file):
    ext = os.path.splitext(file.filename or ".jpg")[1].lower() or ".jpg"
    return _upload_bytes(_file_to_bytes(file),
                         f"profile_{uid}_{os.urandom(3).hex()}{ext}",
                         f"Home/SevaSetu/users/{uid}")

def upload_task_proof(vol_uid, task_id, file):
    ext = os.path.splitext(file.filename or ".jpg")[1].lower() or ".jpg"
    return _upload_bytes(_file_to_bytes(file),
                         f"proof_{os.urandom(4).hex()}{ext}",
                         f"Home/SevaSetu/tasks/{task_id}/proof")

def upload_pil_image(pil_image, file_name, folder_path):
    if not PIL_AVAILABLE:
        return None
    return _upload_bytes(_pil_to_bytes(pil_image), file_name, folder_path)

def delete_imagekit_file(file_id):
    if not file_id:
        return False
    try:
        imagekit.delete_file(file_id)
        print(f"Deleted: {file_id}")
        return True
    except Exception as e:
        print(f"Delete failed ({file_id}): {e}")
        return False

def delete_imagekit_files(file_ids):
    return sum(1 for fid in (file_ids or []) if delete_imagekit_file(fid))