

class Pusher {
    constructor() {
        this.aencoder_ = null;
        this.vencoder_ = null;
        this.videoElement_ = null;
        this.socket_ = null;
        this.sendFrames_ = 0;
        this.videoGop_ = 30;  
    }
    async init(videoElement) {


        this.socket_ = new WebSocket("ws://localhost:8000/pub");

        this.socket_.binaryType = 'arraybuffer';

        this.socket_.onopen = async () => {
            console.log('socket open');
            this.sendFrames_ = 0;
        }

        this.socket_.onmessage = async (event) => {    
        }

        this.socket_.onclose = async (event) => {
            console.log("socket close");
        }

        const constraints = {
            video: { width: { exact: 640 }, height: { exact: 480 } },
            audio: {
                channelCount:2,
                sampleRate:48000,
            }
        }

        // VideoEncoder config 
        this.vencoder_ = new VideoEncoder({
            output: this.handleVideoEncoded.bind(this),
            error: (error) => {
                console.error("video encoder " + error);
            }
        });
        this.vencoder_.configure({ codec: 'vp8', width: 640, height: 480 });

       

        // AudioEncoder config 
        this.aencoder_ = new AudioEncoder({
            output: this.handleAudioEncoded.bind(this),
            error: (error) => {
                console.error("audio encoder " + error);
            }
        });
        this.aencoder_.configure({ codec: 'opus', numberOfChannels: 2, sampleRate: 48000 });
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        let vprocessor = new MediaStreamTrackProcessor(stream.getVideoTracks()[0]);
        let vgenerator = new MediaStreamTrackGenerator('video');
        const vsource = vprocessor.readable;
        const vsink = vgenerator.writable;
        let vtransformer = new TransformStream({ transform: this.videoTransform() });
        vsource.pipeThrough(vtransformer).pipeTo(vsink);


        let aprocessor = new MediaStreamTrackProcessor(stream.getAudioTracks()[0]);
        let agenerator = new MediaStreamTrackGenerator('audio');
        const asource = aprocessor.readable;
        const asink = agenerator.writable;
        let atransformer = new TransformStream({ transform: this.audioTransform() });
        asource.pipeThrough(atransformer).pipeTo(asink);


        let processedStream = new MediaStream();
        processedStream.addTrack(vgenerator);
        processedStream.addTrack(agenerator);
        videoElement.srcObject = processedStream;
        await videoElement.play();


        
    }

    videoTransform(frame, controller) {

        return (frame, controller) => {
           
            const insert_keyframe = (this.sendFrames_ % 30) == 0;
            this.sendFrames_++;
            if (insert_keyframe) {
                console.log('keyframe == ');
            }
            this.vencoder_.encode(frame, { keyFrame: insert_keyframe });
            controller.enqueue(frame);
        }

    }

    audioTransform() {
        return (frame, controller) => {
            this.aencoder_.encode(frame);
            controller.enqueue(frame);
        }
 
    }

    async handleVideoEncoded(chunk) {

        let kind = 'video';
        const { type, timestamp, duration, data } = chunk;
        let data_ = CBOR.encode({
                kind,
                type,
                timestamp,
                duration,
                data: new Uint8Array(data),
            });
        if (this.socket_) {
            this.socket_.send(data_);
        }
       
    }

    async handleAudioEncoded(chunk) {

        let kind = 'audio';
        const {type,timestamp,data} = chunk;
        let data_ = CBOR.encode({
            kind,
            type,
            timestamp,
            data: new Uint8Array(data),
        });
        if (this.socket_) {
            this.socket_.send(data_);
        }
       
    }

    destroy() {
        if (this.socket_) {
            this.socket_.close();
            this.socket_ = null;
        }
    }
}