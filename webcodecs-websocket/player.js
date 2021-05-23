

class Player {
    constructor() {
        this.adecoder_ = null;
        this.vdecoder_ = null;
        this.socket_ = null;

        this.vwriter_ = null;
        this.awriter_ = null;
        
        this.waitKeyframe_ = true;
    }
    async init(videoElement) {

        // VideoDecoder config 
        this.vdecoder_ = new VideoDecoder({
            output: this.handleVideoDecoded.bind(this),
            error: (error) => {
                console.error("video decoder " + error);
            }
        });
        this.vdecoder_.configure({ codec: 'vp8', width: 640, height: 480 });


        // AudioDecoder config 
        this.adecoder_ = new AudioDecoder({
            output: this.handleAudioDecoded.bind(this),
            error: (error) => {
                console.error("audio decoder " + error);
            }
        });
        this.adecoder_.configure({ codec: 'opus', numberOfChannels: 2, sampleRate: 48000 });


        let vgenerator = new MediaStreamTrackGenerator('video');
        this.vwriter_ = vgenerator.writable.getWriter();

       
        let agenerator = new MediaStreamTrackGenerator('audio');
        this.awriter_ = agenerator.writable.getWriter();


        let processedStream = new MediaStream();
        processedStream.addTrack(vgenerator);
        processedStream.addTrack(agenerator);
        videoElement.srcObject = processedStream;

        this.socket_ = new WebSocket("ws://localhost:8000/sub");
        this.socket_.binaryType = 'arraybuffer';

        this.socket_.onopen = async () => {
            console.log('socket open');
        }
  
        this.socket_.onmessage = async (event) => {

            const chunk = CBOR.decode(event.data);
            if (chunk.kind === 'video') {
                if (this.waitKeyframe_ ){
                    if(chunk.type === 'delta'){
                        return;
                    }
                    this.waitKeyframe_ = false;
                    console.log('got first keyframe' + Date.now());
                }
                const encoded = new EncodedVideoChunk(chunk);
                this.vdecoder_.decode(encoded);
            } else {
                const encoded = new EncodedAudioChunk(chunk);
                this.adecoder_.decode(encoded);
            }

        }
        
    }
    async handleVideoDecoded(frame) {
        this.vwriter_.write(frame);
        console.log('video decoded ' + Date.now());
    }

    async handleAudioDecoded(frame) {
        this.awriter_.write(frame);
    }

    destroy() {
        if (this.socket_) {
            this.socket_.close();
            this.socket_ = null;
        }
    }
}



class WebAudioPlayer {
    constructor(options) {
        this.context = new AudioContext();
        this.gain = this.context.createGain();
        this.gain.connect(this.context.destination);
        this.context._connections = (this.context._connections || 0) + 1;
        
        this.startTime = 0;
        this.buffer = null;
        this.wallclockStartTime = 0;
        this.volume = 1;
        this.enabled = true;
        
        this.sampleRate = options.sampleRate || 48000;
        this.numberOfChannels = options.numberOfChannels || 2;
    }

    play(data) {

        if (!this.enabled) {
            return;
        }

        this.gain.gain.value = this.volume;

        var buffer = this.context.createBuffer(2, data.length/2, this.sampleRate);
    }
}