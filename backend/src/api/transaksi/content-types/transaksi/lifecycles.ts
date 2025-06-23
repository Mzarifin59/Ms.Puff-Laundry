export default {
  async beforeCreate(event) {
    const { data } = event.params;

    data.tanggal_pesan = new Date();
  },

  async afterCreate(event) {
    const { result } = event;

    // Ambil data lengkap termasuk detail_transaksis dan layanan
    const dataDraft = await strapi
      .documents("api::transaksi.transaksi")
      .findOne({
        documentId: result.documentId,
        populate: {
          pelanggan: true,
          detail_transaksis: {
            fields: ["id", "jumlah", "subtotal"],
            populate: {
              layanan: true,
            },
          },
        },
      });

    // Menghitung estimasi_selesai
    let waktuSelesai = null;

    const tanggalPesan = new Date(dataDraft.tanggal_pesan);
    const estimasiHariList = (dataDraft.detail_transaksis || []).map((dt) => {
      const est = (dt.layanan?.estimasi_selesai || 0);
      return typeof est === "number" ? est : 0;
    });
    const estimasiHari = Math.max(...estimasiHariList, 0);

    if (estimasiHari > 0) {
      const estimasiSelesai = new Date(tanggalPesan);
      estimasiSelesai.setDate(tanggalPesan.getDate() + estimasiHari);
      waktuSelesai = estimasiSelesai;
    } else {
      // Jika semua estimasi 0, gunakan tanggal pesan
      waktuSelesai = tanggalPesan;
    }

    // Siapkan detail_transaksis untuk EmailJS
    const detailTransaksis = (dataDraft.detail_transaksis || []).map(
      (item) => ({
        layanan_nama: item.layanan?.nama || "-",
        jumlah: item.jumlah,
        subtotal: item.subtotal,
      })
    );

    // Siapkan parameter untuk EmailJS
    const templateParams = {
      pelanggan_nama: dataDraft.pelanggan?.nama || "-",
      email: dataDraft.pelanggan?.email || "-",
      no_transaksi: dataDraft.documentId,
      tanggal: new Date(dataDraft.tanggal_pesan).toLocaleDateString("id-ID", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      }),
      tanggal_selesai: new Date(waktuSelesai).toLocaleDateString(
        "id-ID",
        {
          year: "numeric",
          month: "long",
          day: "numeric",
          weekday: "long",
        }
      ),
      total_harga: dataDraft.total_harga,
      detail_transaksis: detailTransaksis,
      no_whattsapp: process.env.NO_WHATTSAPP || "-",
    };

    try {
      const response = await fetch(
        "https://api.emailjs.com/api/v1.0/email/send",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            service_id: process.env.SERVICE_ID,
            template_id: process.env.TEMPLATE_ONE,
            user_id: process.env.PUBLIC_KEY,
            accessToken: process.env.PRIVATE_KEY,
            template_params: templateParams,
          }),
        }
      );

      if (response.ok) {
        console.log("Email buat transaksi berhasil dikirim via EmailJS.");
      } else {
        const errorText = await response.text();
        console.error(
          "Gagal mengirim email via EmailJS:",
          response.status,
          errorText
        );
      }
    } catch (error) {
      console.error("Gagal mengirim email via EmailJS:", error);
    }

    await strapi.documents("api::transaksi.transaksi").update({
      documentId: result.documentId,
      data: {
        estimasi_selesai: waktuSelesai,
      }
    });
  },

  async beforeUpdate(event) {
    const { where } = event.params;

    const oldData = (await strapi.entityService.findOne(
      "api::transaksi.transaksi",
      where.id,
      {
        populate: {
          detail_transaksis: {
            fields: ["id", "jumlah", "subtotal"],
            populate: {
              layanan: true,
            },
          },
        },
      }
    )) as any;

    // Menghitung estimasi_selesai
    let waktuSelesai = null;

    const tanggalPesan = new Date(oldData.tanggal_pesan);
    const estimasiHariList = (oldData.detail_transaksis || []).map((dt) => {
      const est = (dt.layanan?.estimasi_selesai || 0);
      return typeof est === "number" ? est : 0;
    });
    const estimasiHari = Math.max(...estimasiHariList, 0);

    if (estimasiHari > 0) {
      const estimasiSelesai = new Date(tanggalPesan);
      estimasiSelesai.setDate(tanggalPesan.getDate() + estimasiHari);
      event.params.data.estimasi_selesai = estimasiSelesai;
    } else {
      // Jika semua estimasi 0, gunakan tanggal pesan
      waktuSelesai = tanggalPesan;
      event.params.data.estimasi_selesai = waktuSelesai
    }

    event.state = {
      previousStatusPengerjaan: oldData?.status_pengerjaan,
      previousStatusPembayaran: oldData?.status_pembayaran,
    };
  },

  async afterUpdate(event) {
    const { result } = event;

    const previousStatusPengerjaan = event.state.previousStatusPengerjaan;
    const previousStatusPembayaran = event.state.previousStatusPembayaran;

    const dataWithPelanggan = await strapi
      .documents("api::transaksi.transaksi")
      .findOne({
        documentId: result.documentId,
        populate: {
          pelanggan: true,
          detail_transaksis: {
            fields: ["id", "jumlah", "subtotal"],
            populate: {
              layanan: true,
            },
          },
        },
      });

    const isPengerjaanSelesai =
      result.status_pengerjaan !== previousStatusPengerjaan;
    const isPembayaranLunas =
      result.status_pembayaran !== previousStatusPembayaran;

    if (isPengerjaanSelesai && result.status_pengerjaan === "Selesai") {
      const tanggal_selesai = new Date().toLocaleDateString("id-ID", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      });

      // Update Tanggal Selesai 
      await strapi.documents("api::transaksi.transaksi").update({
        documentId: result.documentId,
        data: {
          tanggal_selesai: new Date(),
        },
      });

      const templateParams = {
        pelanggan_nama: dataWithPelanggan.pelanggan.nama,
        email: dataWithPelanggan.pelanggan.email,
        no_transaksi: result.documentId,
        subject: "✨ Pesanan Anda Telah Selesai - Ms. Puff Laundry",
        information_title: "Pesanan Anda Telah Selesai!",
        information_description:
          "Kami senang memberitahukan bahwa pesanan Anda telah selesai diproses.",
        tanggal_pesan: new Date(result.tanggal_pesan).toLocaleDateString(
          "id-ID",
          {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "long",
          }
        ),
        tanggal_opsi: `Tanggal Selesai : <strong>${tanggal_selesai}</strong>`,
        status: "<p>Status Pengerjaan : <strong>Selesai</strong></p>",
        closing: "Silahkan ambil pesanan Anda di toko kami.",
        no_whattsapp: process.env.NO_WHATTSAPP || "-",
      };

      try {
        const response = await fetch(
          "https://api.emailjs.com/api/v1.0/email/send",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              service_id: process.env.SERVICE_ID,
              template_id: "template_qd75xto",
              user_id: process.env.PUBLIC_KEY,
              accessToken: process.env.PRIVATE_KEY,
              template_params: templateParams,
            }),
          }
        );

        if (response.ok) {
          console.log("Email Status Selesai Terbuat via EmailJS.");
        } else {
          const errorText = await response.text();
          console.error(
            "Gagal mengirim email via EmailJS:",
            response.status,
            errorText
          );
        }
      } catch (error) {
        console.error("Gagal mengirim email via EmailJS:", error);
      }
    }

    if (isPembayaranLunas && result.status_pembayaran === "Sudah Bayar") {
      const estimasi_selesai = new Date(
        result.estimasi_selesai
      ).toLocaleDateString("id-ID", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      });

      const templateParams = {
        pelanggan_nama: dataWithPelanggan.pelanggan.nama,
        email: dataWithPelanggan.pelanggan.email,
        no_transaksi: result.documentId,
        subject: "💰 Pembayaran Berhasil - Ms. Puff Laundry",
        information_title: "Pembayaran Telah Diterima!",
        information_description:
          "Terima kasih! Pembayaran Anda telah kami terima dengan baik.",
        tanggal_pesan: new Date(result.tanggal_pesan).toLocaleDateString(
          "id-ID",
          {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "long",
          }
        ),
        status: "<p>Status Pembayaran : <strong>Lunas</strong></p>",
        closing:
          "Kami sangat menghargai kepercayaan Anda menggunakan jasa Ms. Puff Laundry. Akan segera kami informasikan jika pesanan Anda telah selesai.",
        no_whattsapp: process.env.NO_WHATTSAPP || "-",
      };

      try {
        const response = await fetch(
          "https://api.emailjs.com/api/v1.0/email/send",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              service_id: process.env.SERVICE_ID,
              template_id: process.env.TEMPLATE_TWO,
              user_id: process.env.PUBLIC_KEY,
              accessToken: process.env.PRIVATE_KEY,
              template_params: templateParams,
            }),
          }
        );

        if (response.ok) {
          console.log("Email Status Pembayaran Selesai Terbuat via EmailJS.");
        } else {
          const errorText = await response.text();
          console.error(
            "Gagal mengirim email via EmailJS:",
            response.status,
            errorText
          );
        }
      } catch (error) {
        console.error("Gagal mengirim email via EmailJS:", error);
      }
    }
  },
};
