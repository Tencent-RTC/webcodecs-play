package main

import (
	"context"
	"crypto/tls"
	"encoding/binary"
	"errors"
	"io"
	"log"
	"net/http"

	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"
	"github.com/lucas-clemente/quic-go"
)

const (
	// https://tools.ietf.org/html/draft-vvv-webtransport-quic-02#section-3.1
	alpnQuicTransport = "wq-vvv-01"
	// https://tools.ietf.org/html/draft-vvv-webtransport-quic-02#section-3.2
	maxClientIndicationLength = 65535
)

type clientIndicationKey int16

const (
	clientIndicationKeyOrigin clientIndicationKey = 0
	clientIndicationKeyPath                       = 1
)

type ClientIndication struct {
	// Origin indication value.
	Origin string
	// Path indication value.
	Path string
}

// Config for WebTransportServerQuic.
type Config struct {
	// ListenAddr sets an address to bind server to.
	ListenAddr string
	// TLSCertPath defines a path to .crt cert file.
	TLSCertPath string
	// TLSKeyPath defines a path to .key cert file
	TLSKeyPath string
	// AllowedOrigins represents list of allowed origins to connect from.
	AllowedOrigins []string
}

type WebTransportServerQuic struct {
	config Config
}

func NewWebTransportServerQuic(config Config) *WebTransportServerQuic {
	return &WebTransportServerQuic{
		config: config,
	}
}

// Run server.
func (s *WebTransportServerQuic) Run() error {
	listener, err := quic.ListenAddr(s.config.ListenAddr, s.generateTLSConfig(), nil)
	if err != nil {
		return err
	}
	for {
		sess, err := listener.Accept(context.Background())
		if err != nil {
			return err
		}
		log.Printf("session accepted: %s", sess.RemoteAddr().String())

		go func() {
			defer func() {
				_ = sess.CloseWithError(0, "bye")
				log.Printf("close session: %s", sess.RemoteAddr().String())
			}()
			s.handleSession(sess)
		}()
	}
}

func (s *WebTransportServerQuic) handleSession(sess quic.Session) {
	stream, err := sess.AcceptUniStream(context.Background())
	if err != nil {
		log.Println(err)
		return
	}
	log.Printf("unidirectional stream accepted, id: %d", stream.StreamID())
	indication, err := receiveClientIndication(stream)
	if err != nil {
		log.Println(err)
		return
	}
	log.Printf("client indication: %+v", indication)
	if err := s.validateClientIndication(indication); err != nil {
		log.Println(err)
		return
	}
	err = s.communicate(sess)
	if err != nil {
		log.Println(err)
		return
	}
}

func (s *WebTransportServerQuic) communicate(sess quic.Session) error {
	for {
		stream, err := sess.AcceptStream(context.Background())
		if err != nil {
			return err
		}
		log.Printf("bidirectional stream accepted: %d", stream.StreamID())
		if _, err := io.Copy(loggingWriter{stream}, loggingReader{stream}); err != nil {
			return err
		}
		log.Printf("bidirectional stream closed: %d", stream.StreamID())
	}
}

// The client indication is a sequence of key-value pairs that are
// formatted in the following way:
//
// 0                   1                   2                   3
// 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
// |           Key (16)            |          Length (16)          |
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
// |                           Value (*)                         ...
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
func receiveClientIndication(stream quic.ReceiveStream) (ClientIndication, error) {
	var clientIndication ClientIndication
	reader := io.LimitReader(stream, maxClientIndicationLength)

	done := false

	for {
		if done {
			break
		}

		var key int16
		err := binary.Read(reader, binary.BigEndian, &key)
		if err != nil {
			if err == io.EOF {
				done = true
			} else {
				return clientIndication, err
			}
		}

		var valueLength int16
		err = binary.Read(reader, binary.BigEndian, &valueLength)
		if err != nil {
			return clientIndication, err
		}

		buf := make([]byte, valueLength)
		n, err := reader.Read(buf)
		if err != nil {
			if err == io.EOF {
				done = true
			} else {
				return clientIndication, err
			}
		}
		if int16(n) != valueLength {
			return clientIndication, errors.New("read less than expected")
		}
		value := string(buf)

		switch clientIndicationKey(key) {
		case clientIndicationKeyOrigin:
			clientIndication.Origin = value
		case clientIndicationKeyPath:
			clientIndication.Path = value
		default:
			log.Printf("skip unknown client indication key: %d: %s", key, value)
		}
	}
	return clientIndication, nil
}

func (s *WebTransportServerQuic) generateTLSConfig() *tls.Config {
	cert, err := tls.LoadX509KeyPair(s.config.TLSCertPath, s.config.TLSKeyPath)
	if err != nil {
		log.Fatal(err)
	}
	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		NextProtos:   []string{alpnQuicTransport},
	}
}

func (s *WebTransportServerQuic) validateClientIndication(indication ClientIndication) error {
	return nil
}

// A wrapper for io.Writer that also logs the message.
type loggingWriter struct{ io.Writer }

func (w loggingWriter) Write(b []byte) (int, error) {
	log.Printf("---> %d", len(b))
	return w.Writer.Write(b)
}

// A wrapper for io.Reader that also logs the message.
type loggingReader struct{ io.Reader }

func (r loggingReader) Read(buf []byte) (n int, err error) {
	n, err = r.Reader.Read(buf)
	if n > 0 {
		log.Printf("<--- %d", n)
	}
	return
}

func index(c *gin.Context) {
	c.HTML(http.StatusOK, "index.html", gin.H{})
}

func main() {

	address := ":8000"
	r := gin.Default()
	r.LoadHTMLFiles("./index.html", "./cbor.js", "./script.js")
	r.Use(static.Serve("/", static.LocalFile("./", false)))
	r.GET("/", index)

	go func() {
		r.Run(address)
	}()

	server := NewWebTransportServerQuic(Config{
		ListenAddr:     "0.0.0.0:4433",
		TLSCertPath:    "server.crt",
		TLSKeyPath:     "server.key",
		AllowedOrigins: []string{"localhost"},
	})
	if err := server.Run(); err != nil {
		log.Fatal(err)
	}
}
