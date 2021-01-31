
let codec_string = "vp8";
let decoder;
let transport;
let bidirectionalStream;

async function captureAndEncode() {

    let fps = 30;
    let pending_outputs = 0;
    let frame_counter = 0;

    const constraints = {
        video: { width: 640, height: 480 },
        audio: true
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    let camera = document.getElementById("camera");
    camera.srcObject = stream;
    camera.controls = true;
    camera.muted = true;


    let vtr = new VideoTrackReader(stream.getVideoTracks()[0]);

    const writer = bidirectionalStream.writable.getWriter();

    const init = {
    output: (chunk) => {
        pending_outputs--;
        const { type, timestamp, duration, data } = chunk;
        const encoded = new Uint8Array(
            CBOR.encode({
                type,
                timestamp,
                duration,
                data: new Uint8Array(data),
            }));

        const size = new Uint8Array(4);
        const view = new DataView(size.buffer);
        view.setUint32(0, encoded.length);
        writer.write(new Uint8Array([...size, ...encoded]));

    },
    error: (e) => {
        console.log(e.message);
        vtr.stop();
    }
    };

    const config = {
        codec: codec_string,
        width: 640,
        height: 480,
        bitrate: 1e6,
        framerate: fps,
    };

    let encoder = new VideoEncoder(init);
    encoder.configure(config);

    vtr.start((frame) => {
    if (pending_outputs > 30) {
        // Too many frames in flight, encoder is overwhelmed
        // let's drop this frame.
        return;
    }
    frame_counter++;
    pending_outputs++;
    const insert_keyframe = (frame_counter % 60) == 0;
        encoder.encode(frame, { keyFrame: insert_keyframe });
    });
}


function startDecodingAndRendering() {
    let cnv = document.getElementById("dst");
    let ctx = cnv.getContext("2d", { alpha: false });
    let ready_frames = [];

    async function renderFrame() {

        if (ready_frames.length == 0) {
            return;
        }

        let frame = ready_frames.shift();

        let bitmap = await frame.createImageBitmap();
        ctx.drawImage(bitmap, 0, 0);

        // Immediately schedule rendering of the next frame
        setTimeout(renderFrame, 0);
        frame.close();
    }

    function handleFrame(frame) {
        ready_frames.push(frame);
        setTimeout(renderFrame, 0);
    }

    const init = {
        output: handleFrame,
        error: (e) => {
            console.log(e.message);
        }
    };

    const config = {
        codec: codec_string,
        codedWidth: cnv.width,
        codedHeight: cnv.height
    };

    let decoder = new VideoDecoder(init);
    decoder.configure(config);
    return decoder;
}

async function main() {
    if (!("VideoEncoder" in window)) {
        document.body.innerHTML = "<h1>WebCodecs API is not supported.</h1>";
        return;
    }

    const url = 'quic-transport://localhost:4433/webcodecs';
    transport = new WebTransport(url);

    transport.closed.then(() => {
    console.log('quictransport closed')
    }).catch((error) => {
    console.error('quictransport error ', error)
    })

    decoder = startDecodingAndRendering();

    await transport.ready;
    bidirectionalStream = await transport.createBidirectionalStream();

    captureAndEncode();

    const reader = bidirectionalStream.readable.getReader();

    while (true) {

        let { done, value } = await reader.read();
        if (done) {
            console.log('Done accepting unidirectional streams!');
            return;
        }

        const view = new DataView(value.buffer);
        let size = null;
        try {
            size = view.getUint32(0);
        } catch {
            console.log('error size');
            continue;
        }

        let buffer = value.slice(4);

        while (buffer.length < size) {
            let { done, value } = await reader.read();
            buffer = new Uint8Array([...buffer, ...value]);
        }


        // todo, handle the remain buffer 
        if (buffer.length != size) {
            console.log("buffer length ", buffer.length, " should be ", size);
        }

        const chunk = CBOR.decode(buffer.buffer);
        const encoded = new EncodedVideoChunk(chunk);
        decoder.decode(encoded);
    }

}